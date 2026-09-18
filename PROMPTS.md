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

<!-- Append new entries below every time a prompt materially changes the project. -->
