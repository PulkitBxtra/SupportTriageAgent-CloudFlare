// Plain Worker routes that sit alongside the TriageAgent Durable Object.
// These are cross-customer / infrastructure concerns (seeding the shared
// knowledge base, listing tickets across every customer for the admin
// view, transcribing voice input) that don't belong to any single agent
// instance, so they're handled directly in the Worker's fetch handler
// rather than as agent tools or callable methods.

import { KB_DOCS } from "./kb-docs";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

/**
 * One-time admin route: embeds the seed knowledge-base docs and upserts
 * them into Vectorize. Safe to re-run — upsert overwrites by id.
 */
export async function seedKnowledgeBase(env: Env): Promise<Response> {
  const modelResp = (await env.AI.run(EMBEDDING_MODEL, {
    text: KB_DOCS.map((doc) => doc.text)
  })) as EmbeddingResponse;

  const vectors = KB_DOCS.map((doc, i) => ({
    id: doc.id,
    values: modelResp.data[i],
    metadata: {
      title: doc.title,
      category: doc.category,
      text: doc.text
    }
  }));

  const result = await env.KB_INDEX.upsert(vectors);

  return Response.json({
    ok: true,
    docsEmbedded: vectors.length,
    result
  });
}

/**
 * Admin view: list tickets across every customer, newest first. This is
 * what makes the D1-backed cross-session memory demoable — a single
 * TriageAgent Durable Object only ever sees its own customer's tickets,
 * but this route reads D1 directly across all of them.
 */
export async function listAllTickets(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, customer_id, subject, category, priority, status,
            draft_reply, final_reply, created_at, updated_at, resolved_at
     FROM tickets
     ORDER BY created_at DESC
     LIMIT 200`
  ).all();

  return Response.json({ tickets: results });
}

/**
 * Voice input: transcribe recorded audio bytes via Whisper on Workers AI.
 * The client records with MediaRecorder and POSTs the raw audio blob;
 * we base64-encode it (Whisper's input schema expects base64) and return
 * the transcript as plain text for the user to review before sending.
 */
export async function transcribeVoice(
  request: Request,
  env: Env
): Promise<Response> {
  const audioBuffer = await request.arrayBuffer();
  if (audioBuffer.byteLength === 0) {
    return Response.json({ error: "No audio received" }, { status: 400 });
  }

  const base64Audio = arrayBufferToBase64(audioBuffer);

  const result = (await env.AI.run(WHISPER_MODEL, {
    audio: base64Audio
  })) as { text: string };

  return Response.json({ text: result.text ?? "" });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
