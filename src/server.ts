import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  generateObject,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
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

export class TriageAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const customerId = this.name;

    const result = streamText({
      model: workersai(CHAT_MODEL, { sessionAffinity: this.sessionAffinity }),
      system: `You are the support triage assistant for Loopwave, a fictional SaaS product. A customer (id: ${customerId}) is describing an issue, by typing or by voice-to-text.

Follow this pipeline for every new issue:
1. Call classifyTicket with a short subject and the full description to classify it (category + priority) and open a ticket record. Always do this first for a new issue.
2. Call getCustomerHistory to check whether this customer has had similar or related tickets before, and mention that context if relevant (e.g. "I see you had a similar billing issue last month").
3. Call searchKnowledgeBase with a focused query to find relevant help docs before drafting a reply. Ground your reply in what it returns — don't invent policy details (refund windows, rate limits, retry schedules, etc.) that aren't in the retrieved docs.
4. Call proposeReply with the ticketId and your drafted reply text. This always requires human approval before it's considered sent — after calling it, tell the user the draft is awaiting approval, don't repeat the draft text again.

Be concise and empathetic in drafted replies. If the customer's message is too vague to classify or search on, ask one clarifying question instead of calling tools with guesses.`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: {
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
              prompt: `Classify this customer support ticket for a SaaS product called Loopwave.\n\nSubject: ${subject}\nDescription: ${description}\n\nPick the single best-fitting category and an appropriate priority.`
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
            "Propose a drafted reply to the customer for a given ticket. This always requires human approval before being considered sent.",
          inputSchema: z.object({
            ticketId: z.string(),
            replyText: z.string().describe("The drafted reply to the customer")
          }),
          // Runs immediately when the tool is called (before the human
          // decides), so we use it to persist the draft and self-schedule
          // the escalation check — the escalation clock starts the moment
          // a draft is proposed, not when/if it's approved.
          needsApproval: async ({ ticketId, replyText }) => {
            const now = new Date().toISOString();
            await this.env.DB.prepare(
              `UPDATE tickets SET status = 'awaiting_approval', draft_reply = ?, updated_at = ?
               WHERE id = ? AND customer_id = ?`
            )
              .bind(replyText, now, ticketId, customerId)
              .run();

            const windowSeconds = Number(
              this.env.ESCALATION_WINDOW_SECONDS ?? 120
            );
            await this.schedule(windowSeconds, "checkEscalation", {
              ticketId
            });

            return true;
          },
          execute: async ({ ticketId, replyText }) => {
            const now = new Date().toISOString();
            await this.env.DB.prepare(
              `UPDATE tickets SET status = 'resolved', final_reply = ?, resolved_at = ?, updated_at = ?
               WHERE id = ? AND customer_id = ?`
            )
              .bind(replyText, now, now, ticketId, customerId)
              .run();

            return { ticketId, status: "resolved", finalReply: replyText };
          }
        })
      },
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
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
  async finalizeReplyWithEdit(ticketId: string, editedReply: string) {
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE tickets SET status = 'resolved', draft_reply = ?, final_reply = ?, resolved_at = ?, updated_at = ?
       WHERE id = ? AND customer_id = ?`
    )
      .bind(editedReply, editedReply, now, now, ticketId, this.name)
      .run();

    return { ticketId, status: "resolved", finalReply: editedReply };
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
