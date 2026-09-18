import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  generateObject,
  pruneMessages,
  simulateStreamingMiddleware,
  smoothStream,
  stepCountIs,
  streamText,
  tool,
  wrapLanguageModel
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { seedKnowledgeBase, listAllTickets, transcribeVoice } from "./routes";

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

const TICKET_CATEGORIES = [
  "billing",
  "login_2fa",
  "api_rate_limits",
  "data_export",
  "webhooks",
  "plan_changes",
  "account_deletion",
  "outage_status",
  "other"
] as const;

const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

/**
 * The closing acknowledgment after an approve/edit/reject decision. Tried
 * three different ways of getting Llama 3.3 to produce this reliably
 * (a written instruction, separating it from replyText, forbidding it
 * outright) and it kept finding new ways to get it wrong — repeating the
 * issue, offering to "look into it" as if nothing had happened yet, even
 * leaking a fake JSON tool-call as plain text once toolChoice blocked a
 * real one. There's nothing to decide here, so it's deterministic instead
 * of another LLM call.
 */
function getContinuationAck(messages: readonly { parts: unknown[] }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts) {
      const p = part as {
        type?: string;
        approval?: { approved?: boolean };
      };
      if (p.type !== "tool-proposeReply") continue;
      if (p.approval?.approved === false) {
        return "Understood — let me know what you'd like changed and I'll redraft it.";
      }
      return "Great, that's on its way.";
    }
  }
  return "Got it.";
}

export class TriageAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const customerId = this.name;

    // `continuation: true` means this call was auto-triggered by an
    // approve/edit/reject decision on a previous proposeReply, not a new
    // customer message.
    //
    // The tool definitions (with their real `execute`) must still be passed
    // on a continuation turn — the SDK needs them to actually run the
    // now-approved proposeReply call and produce its output; leaving them
    // out (an earlier version of this fix) left the tool call permanently
    // stuck in "approval-responded" and the ticket never marked resolved.
    const isContinuation = options?.continuation === true;

    // Workers AI streams tool-call argument deltas for this model through
    // both a native `tool_calls` field and an OpenAI-compat
    // `choices[0].delta.tool_calls` field in the same SSE chunk, and
    // workers-ai-provider's stream parser processes both, doubling every
    // argument token (confirmed: identical tools/schema/prompt produce
    // correct output via non-streaming generateText). simulateStreamingMiddleware
    // routes generation through the non-streaming path instead and fakes the
    // stream for the AI SDK; smoothStream re-chunks that for a normal typing
    // animation in the UI.
    //
    // On a continuation turn there's nothing left to decide (see
    // getContinuationAck's comment), so skip the real model entirely and
    // use a mock that returns the deterministic acknowledgment — the real
    // `tools` are still passed below so the SDK can resolve the pending
    // approved call through the same mechanics either way.
    const chatModel = isContinuation
      ? wrapLanguageModel({
          model: new MockLanguageModelV3({
            doGenerate: async () => ({
              finishReason: { unified: "stop" as const, raw: undefined },
              usage: {
                inputTokens: {
                  total: 0,
                  noCache: 0,
                  cacheRead: 0,
                  cacheWrite: 0
                },
                outputTokens: { total: 0, text: 0, reasoning: 0 }
              },
              content: [
                {
                  type: "text" as const,
                  text: getContinuationAck(this.messages)
                }
              ],
              warnings: []
            })
          }),
          middleware: simulateStreamingMiddleware()
        })
      : wrapLanguageModel({
          model: workersai(CHAT_MODEL, {
            sessionAffinity: this.sessionAffinity
          }),
          middleware: simulateStreamingMiddleware()
        });

    const result = streamText({
      model: chatModel,
      experimental_transform: smoothStream(),
      // Ignored on a continuation turn — the mock model above returns a
      // fixed acknowledgment regardless of what it's given.
      system: isContinuation
        ? "unused"
        : `You are the support triage assistant for Loopwave, a fictional SaaS product. You're chatting with a customer (id: ${customerId}) who is typing or speaking. Every reply you write for them goes through proposeReply, where a human reviewer approves it before it's sent — earlier proposeReply calls in this conversation are replies the customer has already received, so treat them as things you have said.

First decide which of these the customer's latest message is:

A) A NEW issue — anything that isn't B or C: a problem, a how-to question, a request. The first substantive message in a conversation is always a new issue, even when it's just a question — every new issue gets a ticket. Run the pipeline once:
1. Call classifyTicket with a short subject and the full description to classify it (category + priority) and open a ticket record.
2. Call getCustomerHistory to check whether this customer has had similar or related tickets before, and mention that context if relevant (e.g. "I see you had a similar billing issue last month").
3. Call searchKnowledgeBase with a focused query to find relevant help docs before drafting a reply. Ground your reply in what it returns — don't invent policy details (refund windows, rate limits, retry schedules, etc.) that aren't in the retrieved docs.
4. Call proposeReply with the reply.

B) A FOLLOW-UP on the issue already being handled — a confirmation ("yes, go ahead"), a thank-you, extra details, or a question about your last reply. Do NOT call classifyTicket or getCustomerHistory again (that would open a duplicate ticket). Call searchKnowledgeBase only if the follow-up needs information you don't already have. Then call proposeReply with a reply that continues the conversation the way a person would: pick up exactly where your last reply left off, respond to what they just said, and never restate the problem, re-introduce yourself, or apologize for the issue again. If they said "yes" to something you offered, confirm what happens next, don't describe the issue from scratch.

C) TOO VAGUE to act on (e.g. "it's broken", "help") — call no tools at all. Just reply in chat with one short clarifying question. When they answer with details, that answer is the new issue (A).

proposeReply's replyText is ONLY the text the customer will read — professional, self-contained, never mentioning drafts, approval, or teammates. Add no other chat message this turn (the interface already shows a "draft awaiting approval" card, and anything else you say would be redundant or contradict it), and don't call any more tools after it.

Write each reply as the complete answer the customer needs: state exactly what will happen next or what they should do. Don't say you're "looking into it", and don't ask the customer to confirm before acting — the reviewer approving the draft is the confirmation. You can't issue refunds, resend exports, change plans or delete anything yourself, so never say you've already done something like that; say what the support team will do and how the customer will know ("Our billing team will refund the duplicate charge — you'll get an email when it's issued"). Prefer the specific facts in the retrieved doc over generic advice, and don't invent timeframes, amounts or links that aren't in it. Be concise and warm, and vary how you open replies so consecutive messages don't read like the same template.`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        // Prune the bulky lookups from older turns, but keep every
        // proposeReply — those are the replies the customer actually
        // received, and the model needs them to continue the thread.
        toolCalls: [
          {
            type: "before-last-2-messages",
            tools: [
              "classifyTicket",
              "getCustomerHistory",
              "searchKnowledgeBase"
            ]
          }
        ],
        reasoning: "before-last-message"
      }),
      toolChoice: isContinuation ? "none" : "auto",
      tools: (() => {
        // The model unreliably passes proposeReply's ticketId argument —
        // it repeatedly substituted the customer id from the system prompt
        // instead of the real ticket id classifyTicket returned, silently
        // no-opping the D1 UPDATE (`WHERE id = ?` matched nothing) while
        // the UI still showed success. classifyTicket always runs earlier
        // in this same call, so its real id is captured here and used
        // directly instead of trusting what the model echoes back.
        let currentTicketId: string | undefined;

        return {
          classifyTicket: tool({
            description:
              "Classify a new support issue into a category + priority via a structured LLM call, and open a ticket record for it. Call this first for any new issue.",
            inputSchema: z.object({
              subject: z.string().describe("Short (< 80 char) ticket subject"),
              description: z
                .string()
                .describe("The customer's full description of the issue")
            }),
            execute: async ({ subject, description }) => {
              const { object } = await generateObject({
                model: workersai(CHAT_MODEL),
                schema: z.object({
                  category: z.enum(TICKET_CATEGORIES),
                  priority: z.enum(TICKET_PRIORITIES),
                  summary: z
                    .string()
                    .describe("One-sentence internal summary of the issue")
                }),
                prompt: `Classify this customer support ticket for a SaaS product called Loopwave.\n\nSubject: ${subject}\nDescription: ${description}\n\nPick the single best-fitting category. Priority: urgent = an outage or the whole team is blocked; high = the customer is blocked, locked out, or losing money; medium = something is degraded or failing but they can still work; low = a how-to or policy question with nothing broken.`
              });

              const ticketId = crypto.randomUUID();
              const now = new Date().toISOString();
              await this.env.DB.prepare(
                `INSERT INTO tickets (id, customer_id, subject, category, priority, transcript, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`
              )
                .bind(
                  ticketId,
                  customerId,
                  subject,
                  object.category,
                  object.priority,
                  description,
                  now,
                  now
                )
                .run();

              currentTicketId = ticketId;
              return {
                ticketId,
                category: object.category,
                priority: object.priority,
                summary: object.summary
              };
            }
          }),

          getCustomerHistory: tool({
            description:
              "Look up this customer's past tickets (category, priority, status, resolution) for context.",
            inputSchema: z.object({}),
            execute: async () => {
              const { results } = await this.env.DB.prepare(
                `SELECT id, subject, category, priority, status, created_at, resolved_at
               FROM tickets
               WHERE customer_id = ?
               ORDER BY created_at DESC
               LIMIT 10`
              )
                .bind(customerId)
                .all();

              return results.length > 0
                ? results
                : "No previous tickets found for this customer.";
            }
          }),

          searchKnowledgeBase: tool({
            description:
              "Search the Loopwave help-center knowledge base for docs relevant to a query. Use this before drafting a reply so the reply is grounded in real policy/docs.",
            inputSchema: z.object({
              query: z.string().describe("Focused search query")
            }),
            execute: async ({ query }) => {
              const embedded = (await this.env.AI.run(EMBEDDING_MODEL, {
                text: [query]
              })) as EmbeddingResponse;

              const { matches } = await this.env.KB_INDEX.query(
                embedded.data[0],
                { topK: 3, returnMetadata: "all" }
              );

              return matches.map((match) => ({
                title: match.metadata?.title,
                category: match.metadata?.category,
                text: match.metadata?.text,
                score: match.score
              }));
            }
          }),

          proposeReply: tool({
            description:
              "Propose the next reply to the customer on the ticket currently being handled. This always requires human approval before being considered sent.",
            inputSchema: z.object({
              ticketId: z
                .string()
                .optional()
                .describe(
                  "The ticketId from classifyTicket's output, if it was called in this conversation"
                ),
              replyText: z
                .string()
                .describe("The drafted reply to the customer")
            }),
            // Runs immediately when the tool is called (before the human
            // decides), so we use it to persist the draft and self-schedule
            // the escalation check — the escalation clock starts the moment
            // a draft is proposed, not when/if it's approved.
            needsApproval: async ({ ticketId, replyText }) => {
              const realTicketId =
                (await this.resolveTicketId(currentTicketId ?? ticketId)) ??
                (await this.openFallbackTicket());

              const now = new Date().toISOString();
              await this.env.DB.prepare(
                `UPDATE tickets SET status = 'awaiting_approval', draft_reply = ?, updated_at = ?
               WHERE id = ?`
              )
                .bind(replyText, now, realTicketId)
                .run();

              const windowSeconds = Number(
                this.env.ESCALATION_WINDOW_SECONDS ?? 120
              );
              await this.schedule(windowSeconds, "checkEscalation", {
                ticketId: realTicketId
              });

              return true;
            },
            execute: async ({ ticketId, replyText }) => {
              // Approval arrives on a separate continuation call to
              // onChatMessage — a fresh invocation whose `currentTicketId`
              // closure is empty — so only the resolver can be trusted here.
              const realTicketId = await this.resolveTicketId(
                currentTicketId ?? ticketId
              );
              if (realTicketId) {
                const now = new Date().toISOString();
                await this.env.DB.prepare(
                  `UPDATE tickets SET status = 'resolved', final_reply = ?, resolved_at = ?, updated_at = ?
                   WHERE id = ?`
                )
                  .bind(replyText, now, now, realTicketId)
                  .run();
              }

              return {
                ticketId: realTicketId,
                status: "resolved",
                finalReply: replyText
              };
            }
          })
        };
      })(),
      // 5 = the 4 pipeline tool calls (classify, history, search, propose)
      // plus one closing text step. On a continuation turn, toolChoice
      // "none" blocks new tool calls, so 2 is enough for the SDK to
      // resolve the pending approved call plus the closing text step.
      stopWhen: stepCountIs(isContinuation ? 2 : 5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse({
      // Default is a bare "An error occurred." — surface the actual reason
      // (e.g. the Workers AI free-tier daily quota) so the UI can show it.
      onError: (error) =>
        error instanceof Error ? error.message : "Something went wrong."
    });
  }

  /**
   * Scheduled by proposeReply's needsApproval hook. If the ticket is still
   * sitting un-approved when this fires, flip it to escalated — this is
   * the Durable Object's own durable scheduling doing the escalation,
   * no cron trigger involved. A no-op if the draft was approved, rejected
   * and re-drafted into a fresh proposeReply call, or already escalated.
   */
  async checkEscalation(payload: { ticketId: string }) {
    const row = await this.env.DB.prepare(
      `SELECT status FROM tickets WHERE id = ?`
    )
      .bind(payload.ticketId)
      .first<{ status: string }>();

    if (row?.status === "awaiting_approval") {
      const now = new Date().toISOString();
      await this.env.DB.prepare(
        `UPDATE tickets SET status = 'escalated', updated_at = ? WHERE id = ?`
      )
        .bind(now, payload.ticketId)
        .run();

      this.broadcast(
        JSON.stringify({
          type: "ticket-escalated",
          ticketId: payload.ticketId,
          timestamp: now
        })
      );
    }
  }

  /**
   * The "edit" half of approve/edit/reject: the built-in tool-approval
   * mechanism only supports approving or rejecting a tool call as-is, so
   * an edited reply is finalized directly here (bypassing proposeReply's
   * execute) and the client then closes out the pending tool-call part
   * with addToolOutput.
   */
  @callable()
  async finalizeReplyWithEdit(
    ticketId: string | undefined,
    editedReply: string
  ) {
    const realTicketId = await this.resolveTicketId(ticketId);
    if (realTicketId) {
      const now = new Date().toISOString();
      await this.env.DB.prepare(
        `UPDATE tickets SET status = 'resolved', draft_reply = ?, final_reply = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(editedReply, editedReply, now, now, realTicketId)
        .run();
    }

    return {
      ticketId: realTicketId,
      status: "resolved",
      finalReply: editedReply
    };
  }

  /**
   * Which ticket a reply belongs to. The model's ticketId argument can't be
   * trusted (it has echoed the customer id from the system prompt instead
   * of the real id) and on a follow-up turn classifyTicket isn't called at
   * all, so there's nothing to capture. A conversation handles one issue
   * at a time, so a candidate id is accepted only if it's really one of
   * this customer's tickets; otherwise the reply belongs to the customer's
   * most recent ticket.
   */
  private async resolveTicketId(
    candidate: string | undefined
  ): Promise<string | undefined> {
    if (candidate) {
      const match = await this.env.DB.prepare(
        `SELECT id FROM tickets WHERE id = ? AND customer_id = ?`
      )
        .bind(candidate, this.name)
        .first<{ id: string }>();
      if (match) return match.id;
    }
    const latest = await this.env.DB.prepare(
      `SELECT id FROM tickets WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1`
    )
      .bind(this.name)
      .first<{ id: string }>();
    return latest?.id;
  }

  /**
   * A reply must always belong to a ticket — that record is the memory the
   * admin view and getCustomerHistory read. If the model drafted a reply
   * without ever calling classifyTicket (it did this for plain how-to
   * questions), open an unclassified ticket from the customer's last
   * message rather than letting the reply go unrecorded.
   */
  private async openFallbackTicket(): Promise<string> {
    let lastUserText = "";
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role !== "user") continue;
      lastUserText = m.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join(" ")
        .trim();
      break;
    }
    const ticketId = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `INSERT INTO tickets (id, customer_id, subject, category, priority, transcript, status, created_at, updated_at)
       VALUES (?, ?, ?, 'other', 'low', ?, 'new', ?, ?)`
    )
      .bind(
        ticketId,
        this.name,
        lastUserText.slice(0, 80) || "Untitled",
        lastUserText,
        now,
        now
      )
      .run();
    return ticketId;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/admin/seed-kb" && request.method === "POST") {
      return seedKnowledgeBase(env);
    }
    if (url.pathname === "/api/admin/tickets" && request.method === "GET") {
      return listAllTickets(env);
    }
    if (url.pathname === "/api/voice/transcribe" && request.method === "POST") {
      return transcribeVoice(request, env);
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
