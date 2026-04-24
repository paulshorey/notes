/**
 * Standalone script to regenerate ALL embeddings for notes and tags.
 *
 * Usage:
 *   MARKETING_DB_URL=… JINA_API_KEY=… node scripts/regenerate-embeddings.mjs [--user <id>] [--dry-run] [--batch-size <n>]
 *
 * Flags:
 *   --user <id>       Only process a single user (default: all users)
 *   --dry-run         Print what would be updated without writing
 *   --batch-size <n>  Jina batch size per request (default: 50, max 2048)
 *
 * IMPORTANT: The text-building logic and embedding constants here MUST stay
 * in sync with lib/db-marketing/services/notes-embeddings.ts — that file is
 * the canonical source used at runtime by the app. If the embedding model,
 * dimensions, or text format change, update BOTH files.
 */

import process from "node:process";
import { Client } from "pg";

// ─── Shared constants (keep in sync with services/notes-embeddings.ts) ───────

const JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings";
const JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
const JINA_EMBEDDING_DIMENSIONS = 1024;
const CURRENT_NOTE_EMBEDDING_MODEL = `${JINA_EMBEDDING_MODEL}:notes-v3`;

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

const DRY_RUN = args.includes("--dry-run");
const BATCH_SIZE = Math.min(Math.max(Number(flagValue("--batch-size")) || 50, 1), 2048);
const SINGLE_USER_ID = flagValue("--user") ? Number(flagValue("--user")) : null;

// ─── Environment ─────────────────────────────────────────────────────────────

const connectionString = process.env.MARKETING_DB_URL;
if (!connectionString) {
  throw new Error("MARKETING_DB_URL environment variable is required.");
}

const jinaApiKey = process.env.JINA_API_KEY?.trim();
if (!jinaApiKey) {
  throw new Error("JINA_API_KEY environment variable is required.");
}

// ─── Text normalization (mirrors services/notes-embeddings.ts) ───────────────

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

// ─── Jina embedding fetch ───────────────────────────────────────────────────

/**
 * @param {string[]} inputs
 * @param {"retrieval.query" | "retrieval.passage"} task
 */
async function fetchEmbeddings(inputs, task) {
  if (inputs.length === 0) return [];

  const response = await fetch(JINA_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jinaApiKey}`,
    },
    body: JSON.stringify({
      model: JINA_EMBEDDING_MODEL,
      input: inputs,
      task,
      dimensions: JINA_EMBEDDING_DIMENSIONS,
      normalized: true,
      truncate: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Jina error (${response.status}): ${payload?.detail ?? "unknown"}`
    );
  }

  if (!payload?.data || payload.data.length !== inputs.length) {
    throw new Error("Jina returned an unexpected embeddings payload.");
  }

  return [...payload.data]
    .sort((left, right) => left.index - right.index)
    .map((item) => {
      if (item.embedding.length !== JINA_EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Expected ${JINA_EMBEDDING_DIMENSIONS} dimensions, got ${item.embedding.length}.`
        );
      }
      return item.embedding;
    });
}

// ─── Database helpers ────────────────────────────────────────────────────────

const client = new Client({ connectionString });
await client.connect();

async function getUserIds() {
  if (SINGLE_USER_ID !== null) {
    return [SINGLE_USER_ID];
  }

  const { rows } = await client.query(
    "SELECT id FROM public.user_v1 ORDER BY id"
  );
  return rows.map((r) => r.id);
}

async function getTagsForUser(userId) {
  const { rows } = await client.query(
    `SELECT id, label
     FROM public.user_note_tag_v1
     WHERE user_id = $1
       AND NULLIF(btrim(label), '') IS NOT NULL
     ORDER BY id`,
    [userId]
  );
  return rows;
}

async function getNotesForUser(userId) {
  const { rows } = await client.query(
    `SELECT n.id, n.description
     FROM public.user_note_v1 n
     WHERE n.user_id = $1
       AND NULLIF(btrim(n.description), '') IS NOT NULL
     ORDER BY n.id`,
    [userId]
  );
  return rows;
}

// ─── Regeneration logic ──────────────────────────────────────────────────────

async function regenerateTags(userId, tags) {
  if (tags.length === 0) return 0;

  let updated = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < tags.length; i += BATCH_SIZE) {
    const batch = tags.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => normalizeText(c.label));
    const nonEmpty = batch
      .map((c, idx) => ({ ...c, text: texts[idx] }))
      .filter((c) => c.text !== "");

    if (nonEmpty.length === 0) continue;

    const embeddings = await fetchEmbeddings(
      nonEmpty.map((c) => c.text),
      "retrieval.passage"
    );

    for (let j = 0; j < nonEmpty.length; j++) {
      const cat = nonEmpty[j];
      const vectorLiteral = JSON.stringify(embeddings[j]);

      if (DRY_RUN) {
        console.log(`  [dry-run] tag ${cat.id} "${cat.label}" → embedding`);
      } else {
        await client.query(
          `UPDATE public.user_note_tag_v1
           SET tag_embedding = $1::vector,
               embedding_model = $2,
               embedding_updated_at = $3
           WHERE id = $4 AND user_id = $5`,
          [vectorLiteral, CURRENT_NOTE_EMBEDDING_MODEL, now, cat.id, userId]
        );
      }

      updated++;
    }
  }

  return updated;
}

async function regenerateNotes(userId, notes) {
  if (notes.length === 0) return 0;

  let updated = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);
    const texts = batch.map((n) => normalizeText(n.description));
    const nonEmpty = batch
      .map((n, idx) => ({ ...n, text: texts[idx] }))
      .filter((n) => n.text !== "");

    if (nonEmpty.length === 0) continue;

    const embeddings = await fetchEmbeddings(
      nonEmpty.map((n) => n.text),
      "retrieval.passage"
    );

    for (let j = 0; j < nonEmpty.length; j++) {
      const note = nonEmpty[j];
      const vectorLiteral = JSON.stringify(embeddings[j]);

      if (DRY_RUN) {
        const desc = (note.description || "").slice(0, 40);
        console.log(`  [dry-run] note ${note.id} "${desc}…" → embedding`);
      } else {
        await client.query(
          `UPDATE public.user_note_v1
           SET description_embedding = $1::vector,
               embedding_model = $2,
               embedding_updated_at = $3
           WHERE id = $4 AND user_id = $5`,
          [vectorLiteral, CURRENT_NOTE_EMBEDDING_MODEL, now, note.id, userId]
        );
      }

      updated++;
    }
  }

  return updated;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(
  `Regenerating embeddings (model: ${CURRENT_NOTE_EMBEDDING_MODEL}, batch: ${BATCH_SIZE}${DRY_RUN ? ", DRY RUN" : ""})`
);

const userIds = await getUserIds();
let totalTags = 0;
let totalNotes = 0;

for (const userId of userIds) {
  const tags = await getTagsForUser(userId);
  const notes = await getNotesForUser(userId);

  console.log(
    `User ${userId}: ${tags.length} tags, ${notes.length} notes`
  );

  const catUpdated = await regenerateTags(userId, tags);
  totalTags += catUpdated;

  const noteUpdated = await regenerateNotes(userId, notes);
  totalNotes += noteUpdated;

  console.log(
    `  → ${catUpdated} tags, ${noteUpdated} notes updated`
  );
}

console.log(
  `\nDone. ${totalTags} tags, ${totalNotes} notes ${DRY_RUN ? "would be " : ""}updated across ${userIds.length} user(s).`
);

await client.end();
