# Prompt History — Support Triage Agent

This file logs the prompt history for building this project, as required by
the Cloudflare take-home assignment ("AI-assisted coding is encouraged, but
you have to submit prompt history"). Entries are appended in order as the
project evolves — including entries from the planning session that happened
before this repo existed.

---

### [1] Scoped the assignment

**Prompt:**

> i'm apply to cloudflare / they've asked to build this / [pasted the Cloudflare take-home assignment text: LLM + workflow/coordination + chat-or-voice input + memory/state, prompt history required]

**Result:** Scoped the assignment requirements and discussed candidate app concepts.

---

### [2] Selected the concept and confirmed architecture

**Prompt:**

> this is the links they've shared / AI-powered application on Cloudflare -> https://agents.cloudflare.com/ / Find additional documentation here. -> https://developers.cloudflare.com/agents/

(then selected "Support Triage Agent" from proposed options, and approved voice input for v1 after confirming no external voice API, e.g. ElevenLabs, is needed since Workers AI Whisper covers STT)

**Result:** Landed on the Support Triage Agent concept and the Durable Object + D1 + Vectorize + Workers AI architecture.

---

### [3] Wrote the project spec

**Prompt:**

> give me a human sound spec message for this, don't start building this now

**Result:** Wrote a plain-language project spec, no code yet.

---

### [4] Clarified the placeholder product name

**Prompt:**

> what's loopwave?

**Result:** Clarified it's a placeholder fictional product name for the demo, not a real product.

---

### [5] Created the PROMPTS.md template

**Prompt:**

> make sure Note: AI-assisted coding is encouraged, but you have to submit prompt history. so give a plain from with which i can start scafolding the project

**Result:** Created a PROMPTS.md template.

---

### [6] First draft of a build prompt (same-repo assumption)

**Prompt:**

> no, i'll start a new onversation give me a prompt with which i can start building this agent

**Result:** Wrote a self-contained build prompt for a fresh session (assumed continuing in the same repo).

---

### [7] Revised for a brand-new repo

**Prompt:**

> no, i'll start in a different repo from scratch

**Result:** Revised the prompt for a brand new repo — this is the prompt that kicked off actual implementation.

---

### [8] Kicked off implementation

**Prompt:**

> [Full build brief pasted into a fresh session in the new SupportTriageAgent-CloudFlare repo: build the Support Triage Agent end-to-end — scaffold from cloudflare/agents-starter, wire up D1 (tickets table), Vectorize (KB_INDEX, bge-base-en-v1.5), Llama 3.3 for classification + drafting, Whisper for voice input, human-in-the-loop approval via the starter's tool-approval UI, self-scheduled escalation checks via this.schedule, rebrand the frontend, write a README with my own deploy steps, and confirm before creating/pushing to GitHub.]

**Result:** Confirmed repo already existed locally with a `README.md` and a `origin` remote (`PulkitBxtra/SupportTriageAgent-CloudFlare`) already configured. Seeded this PROMPTS.md file and began scaffolding.

---

### [9] Built the full agent end-to-end

**Result:** Same session as [8], no further user prompt — completed the build described there in one pass:

- Cloned `cloudflare/agents-starter` in (its own `create-cloudflare` CLI scaffolding path errored, so used `git clone` directly) and merged it into this repo, keeping the existing `.git` and `README.md`.
- Read the starter's actual current source (`src/server.ts`, `src/app.tsx`, `wrangler.jsonc`, `package.json`) before changing anything — it turned out to use `@cloudflare/ai-chat`'s `AIChatAgent` + Kumo UI + `@callable()` decorators, not the older bare `agents`-package shape assumed in the original brief, so the rewrite matched what was actually there.
- Verified exact current Workers AI model IDs against `developers.cloudflare.com` before using them, rather than guessing: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/openai/whisper-large-v3-turbo` (audio input is base64), `@cf/baai/bge-base-en-v1.5` (768-dim), and confirmed the Vectorize insert/query shapes and `wrangler.jsonc` binding formats against the official Vectorize + Workers AI tutorial.
- `wrangler.jsonc`: renamed the Durable Object to `TriageAgent`, added `DB` (D1) and `KB_INDEX` (Vectorize, 768-dim/cosine) bindings, added `/api/*` to `run_worker_first`, added an `ESCALATION_WINDOW_SECONDS` var.
- `migrations/0001_init.sql`: `tickets` table.
- `src/kb-docs.ts`: 8 seed help docs for "Loopwave" (billing, login/2FA, API rate limits, data export, webhooks, plan changes, account deletion, outage status).
- `src/routes.ts`: plain Worker routes — `POST /api/admin/seed-kb` (embed + upsert the docs), `GET /api/admin/tickets` (cross-customer admin list), `POST /api/voice/transcribe` (Whisper).
- `src/server.ts`: rewrote `TriageAgent` with the triage pipeline as tools — `classifyTicket` (structured Llama 3.3 call via `generateObject`, opens a D1 ticket), `getCustomerHistory` (D1 lookup keyed by `this.name`), `searchKnowledgeBase` (embed + Vectorize query), `proposeReply` (`needsApproval` always true; the approval-time hook persists the draft _and_ self-schedules `checkEscalation` via `this.schedule()` — the escalation clock starts the moment a draft is proposed, not if/when approved). Added `checkEscalation` (flips a still-`awaiting_approval` ticket to `escalated`, no-op otherwise) and a `finalizeReplyWithEdit` `@callable()` method for the "edit" half of approve/edit/reject, since the SDK's built-in approval flow only supports approve-as-is or reject.
- `src/app.tsx`: rebranded to "Loopwave Support", removed the MCP panel and image-attachment UI, added a mic button (`MediaRecorder` → `/api/voice/transcribe` → populates the input box for review), added a special approval card for `proposeReply` with Approve / Edit (inline textarea, submits via `finalizeReplyWithEdit` + `addToolOutput`) / Reject, added an Admin panel (`GET /api/admin/tickets`) to demo cross-session memory, and a customer-id switcher (persisted in `localStorage`, keys the Durable Object's `name`) so returning-customer memory is demoable.
- Verified `npm run check` (format + lint + typecheck) and `vite build` (frontend bundles) pass. Could not run `npm run dev` end-to-end here — Workers AI always proxies to a real Cloudflare account even in local dev, which needs the user's own `wrangler login`.
- `README.md`: full setup/deploy steps (`wrangler login`, `d1 create` + paste the id in, `d1 execute` the migration, `vectorize create`, `npm run dev`, hit `/api/admin/seed-kb` once, `npm run deploy`).

---

### [10] Live setup and first real test

**Prompt:**

> test this first and remove Co_autor or any claude signautre anywhere

(then, when asked how to test given it needs a real Cloudflare account: "I'll log in myself, you drive")

**Result:** Stripped the AI co-author line from the commit. After `wrangler login`, created the D1 database (id pasted into `wrangler.jsonc`), the Vectorize index (768-dim, cosine, `remote: true` so it works under `wrangler dev`), applied the migration locally and remotely, seeded the knowledge base, and verified the classification and RAG search routes against the real account.

---

### [11] Tool-call arguments arriving corrupted

**Prompt:**

> getting this error [pasted a message whose `classifyTicket` tool call had failed 8 times in a row with `rawInput` like `"II can can't't get get past past the the2 2FAFA screen…"`]

**Result:** Isolated it to streaming: the identical model/tools/schema/prompt produced correct output via non-streaming `generateText` but doubled every argument token via `streamText`. Cause in `workers-ai-provider`'s stream parser, which processes tool-call deltas from both the native `tool_calls` field and the OpenAI-compat `choices[0].delta.tool_calls` field when Workers AI sends both for this model. Fixed by wrapping the model in the AI SDK's `simulateStreamingMiddleware` (generation goes through the non-streaming path; the stream is simulated) plus `smoothStream` for the typing animation. Llama 3.3 stays the only LLM.

---

### [12] Duplicate tickets after approving

**Prompt:**

> the same approve message is coming multiple times

> same tickets are comming again and again

**Result:** Ticket timestamps showed each duplicate created ~4 seconds after the previous one was approved: approving auto-continues the conversation, and the model re-ran the whole pipeline on that continuation turn. First fix was prompt-only and did not hold. Final fix uses the SDK's `options.continuation` flag: on a continuation turn the model gets `toolChoice: "none"` (the tool definitions must still be passed, otherwise the SDK cannot run the now-approved call and the ticket stays stuck in `approval-responded`), and the closing acknowledgment is a deterministic string from a mock model rather than an LLM call, after the model produced wrong or leaked text three different ways.

---

### [13] Make the app legible to an evaluator

**Prompt:**

> the app is not good enough for any evaluator, it doesn't give the gist of what we have/ trying to build can you improve the UX so that the evaluator enderstands what we have built

> make sure debug mode is for evaluatior and non-debug is for normal user

**Result:** Added a requirements strip (Llama 3.3 / Durable Object agent / Chat + voice / D1 + Vectorize) and a live 4-stage pipeline stepper, plain-language labels for every tool call naming which Cloudflare primitive does the work, and then gated all of that behind the existing Debug toggle: normal mode reads like a support chat ("Looking into your issue…", "Found relevant help docs"), debug mode shows tool names, the Cloudflare-primitive explanation, raw input/output JSON and the raw message dump. Also fixed two dead CSS classes (`kumo-accent`, `kumo-ring`) inherited from the starter.

---

### [14] Approved reply never shown to the customer

**Prompt:**

> it's showing different message that i approve vs what the end user is seeing

> open this using claude in chrome and test yourself

> [pasted the Debug-mode JSON of a full exchange]

**Result:** Drove the app in a headless browser (Playwright) instead of guessing from reports. Found, in order: the tool part's post-approval state is `approval-responded`, which the UI didn't render; the model was passing the customer id as `proposeReply`'s `ticketId`, so the D1 `UPDATE … WHERE id = ?` silently matched nothing while the UI reported success; and — the actual complaint — the approved reply text was never rendered as a message to the customer, only a status line and the acknowledgment. Fixed by resolving the ticket id server-side (a candidate id is accepted only if it belongs to this customer, otherwise the customer's most recent ticket), rendering an approved/edited reply as the assistant's actual chat bubble, and hiding the redundant acknowledgment once a reply is shown. Verified approve, edit and reject end-to-end in the browser with D1 as the source of truth.

---

### [15] Follow-ups should read like one conversation

**Prompt:**

> i observed an issue / both these texts seems disconnected, modify the prompt to make this feel like a human conversation [pasted a first reply asking "Can you please confirm…", the customer's "yes go ahead", and a second reply that re-ran the whole pipeline and re-introduced the problem]

**Result:** The prompt treated every message as a new issue. It now distinguishes a new issue (run the pipeline) from a follow-up on the current one (no `classifyTicket`/`getCustomerHistory`, so no duplicate ticket; search only if new information is needed; reply continues where the last one left off, never restating the problem), and asks for replies that commit to an answer instead of "looking into it" or asking the customer to confirm. `pruneMessages` now keeps every earlier `proposeReply` in context so the model can see what it already told the customer; `proposeReply`'s `ticketId` is optional and resolved server-side. Verified in the browser: the follow-up skips the lookups, continues the thread, and updates the same single ticket.

---

### [16] Evaluate how the agent performs

**Prompt:**

> cool, run and eval now. on how the agent is performing

**Result:** Wrote a headless-browser eval (Playwright, in a scratch directory, not part of the repo) that drives the real app through all 8 knowledge-base categories plus edge cases — a vague message, a returning customer with a second distinct issue, and the timed escalation — approving each draft and scoring it against D1 (category, ticket count, status) and the KB text (required facts present, invented URLs/timeframes absent). First run: 7/7 categories correct, every approved reply resolved in D1, escalation fired at ~120s with the toast, returning customer got 2 tickets, no duplicates, ~10–13s per full pipeline. Weaknesses found and addressed: how-to questions ("when does a downgrade kick in?") were answered without opening a ticket (prompt: every first substantive message is a new issue, plus a server-side fallback that opens an unclassified ticket if a reply is ever proposed without one); "it's broken" got a clarifying question but also a hallucinated `billing` ticket (prompt: vague → plain question, no tools); replies claimed actions the agent can't take ("I've gone ahead and refunded…") and invented timeframes (prompt: describe what support will do, never as already done; no invented timeframes/amounts/links); every ticket came back `high` (classification prompt now has a priority rubric). The re-run could not execute: the Workers AI free-tier daily quota (10,000 neurons) was exhausted by the day's testing, which also exposed that model failures were swallowed silently — the error is now surfaced as a toast (verified against the real quota error) and the quota is documented in the README. The post-fix prompt changes are typechecked but not yet re-evaluated live.

---

<!-- Append new entries below every time a prompt materially changes the project. -->
