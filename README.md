# Loopwave Support Triage Agent

An AI-powered support-ticket triage agent, built for the Cloudflare take-home
assignment. A customer describes an issue (typed or spoken) to a chat agent,
which classifies it, checks the customer's ticket history, searches a
knowledge base, and drafts a reply — but the draft is never sent without a
human approving, editing, or rejecting it first.

Prompt history for this project is logged in [`PROMPTS.md`](./PROMPTS.md).

## How it maps to the assignment

| Requirement             | Implementation                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM                     | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on Workers AI — used for a structured classification call (category + priority) and for drafting the reply                                                                 |
| Workflow / coordination | A [Cloudflare Agent](https://developers.cloudflare.com/agents/) (Durable Object, via the Agents SDK) runs the triage pipeline as its tool-calling loop, and self-schedules an escalation check via `this.schedule()`                  |
| Chat or voice input     | React chat UI on Cloudflare Pages/Workers assets, plus a mic button that records audio and transcribes it via Whisper (`@cf/openai/whisper-large-v3-turbo`) on Workers AI — no external voice API                                     |
| Memory / state          | The Durable Object holds the live conversation per customer; D1 holds the structured ticket record (status, classification, resolution) so the agent has memory across sessions; Vectorize holds embedded knowledge-base docs for RAG |

## Architecture

```
Browser (chat + mic)
   │  WebSocket (chat)         │  POST audio (voice)
   ▼                           ▼
TriageAgent (Durable Object)   /api/voice/transcribe (Whisper)
   │
   ├─ classifyTicket ──────────► Llama 3.3 (structured output) ──► D1 (new ticket)
   ├─ getCustomerHistory ──────► D1 (past tickets for this customer)
   ├─ searchKnowledgeBase ─────► bge-base-en-v1.5 embed ──► Vectorize (KB_INDEX)
   └─ proposeReply ────────────► held for human approval
        ├─ approve   → execute()             → D1: status = resolved
        ├─ edit+send → finalizeReplyWithEdit → D1: status = resolved (edited text)
        ├─ reject    → stays awaiting_approval, agent can re-draft
        └─ (no action within ESCALATION_WINDOW_SECONDS)
              → checkEscalation (self-scheduled) → D1: status = escalated
```

The one Durable Object instance per customer (keyed by the `name` passed to
`useAgent`) is the live, per-conversation memory. D1 is the durable,
cross-session record — a single admin route (`GET /api/admin/tickets`) reads
across every customer's tickets to prove that memory persists and is
queryable outside any one conversation.

## Project structure

- `src/server.ts` — the `TriageAgent` Durable Object (chat loop + tools) and the Worker's `fetch` entrypoint
- `src/routes.ts` — plain Worker routes: KB seeding, admin ticket list, voice transcription
- `src/kb-docs.ts` — seed content for the knowledge base (8 short help docs for the fictional product "Loopwave")
- `src/app.tsx` — chat UI, approval UI (approve/edit/reject), mic button, admin panel
- `migrations/0001_init.sql` — D1 schema (`tickets` table)

## Setup

These steps need your own Cloudflare account and can't be run from here.

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 database

```bash
npx wrangler d1 create support-triage-agent-db
```

Copy the `database_id` from the output into `wrangler.jsonc` — replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID` under `d1_databases`.

Then apply the schema:

```bash
npx wrangler d1 execute support-triage-agent-db --remote --file=./migrations/0001_init.sql
```

(Drop `--remote` to also apply it locally for `wrangler dev`.)

### 4. Create the Vectorize index

```bash
npx wrangler vectorize create support-triage-kb --dimensions=768 --metric=cosine
```

768 dimensions matches the embedding model (`@cf/baai/bge-base-en-v1.5`).

### 5. Regenerate types (optional but recommended)

```bash
npm run types
```

### 6. Run locally

```bash
npm run dev
```

Workers AI always proxies to your real Cloudflare account (even in local
dev — there's no local model runtime), so step 2 (`wrangler login`) is
required before this works.

### 7. Seed the knowledge base

Once the dev server (or a deployment) is running, hit the seed route once:

```bash
curl -X POST http://localhost:5173/api/admin/seed-kb
```

This embeds the 8 docs in `src/kb-docs.ts` and upserts them into Vectorize.
Safe to re-run — it upserts by id.

### 8. Deploy

```bash
npm run deploy
```

Then re-run step 7 against the deployed URL (`https://<your-worker>.<your-subdomain>.workers.dev/api/admin/seed-kb`).

## Using it

- Open the app, describe an issue (or hold the mic button and speak).
- Watch the agent call `classifyTicket` → `getCustomerHistory` →
  `searchKnowledgeBase` → `proposeReply` in the tool-call stream.
- When a draft reply appears, **Approve**, **Edit** (then approve the edited
  text), or **Reject** it — this is the human-in-the-loop gate; nothing is
  considered "sent" until you act on it.
- Click **Admin** to see every ticket across every customer, pulled
  directly from D1 — this is the cross-session memory in action.
- The customer id shown under the header (`customer-xxxxxxxx`) is what
  keys both the Durable Object instance and the D1 rows. It's stored in
  `localStorage` so returning as the same "customer" preserves history;
  click it to switch to a different id and demo a fresh customer, or one
  you've talked to before.
- If you approve nothing within `ESCALATION_WINDOW_SECONDS` (120s by
  default — tune it in `wrangler.jsonc` under `vars`), the agent
  self-schedules an escalation check and flips the ticket to `escalated`
  automatically, no cron involved.

## Notes

- "Loopwave" is a placeholder name for a fictional SaaS product, used only
  to give the knowledge base and drafted replies something concrete to
  reference.
- The chat/tool-approval UI comes from Cloudflare's
  [`agents-starter`](https://github.com/cloudflare/agents-starter) template
  (`AIChatAgent` + `@cloudflare/ai-chat`), stripped of its MCP panel and
  image-attachment UI and extended with the triage tools, voice input, and
  the edit-before-approving flow.
