/**
 * Standalone script to regenerate ALL embeddings for items, categories, and tags.
 *
 * Usage:
 *   DB_ITEMS_URL=… JINA_API_KEY=… node scripts/regenerate-embeddings.mjs [--user <id>] [--dry-run] [--batch-size <n>]
 *
 * Flags:
 *   --user <id>       Only process a single user (default: all users)
 *   --dry-run         Print what would be updated without writing
 *   --batch-size <n>  Jina batch size per request (default: 50, max 2048)
 *
 * IMPORTANT: The text-building logic and embedding constants here MUST stay
 * in sync with lib/db-items/services/item-embeddings.ts — that file is
 * the canonical source used at runtime by the app. If the embedding model,
 * dimensions, or text format change, update BOTH files.
 */

import process from "node:process"
import { Client } from "pg"

// ─── Shared constants (keep in sync with services/item-embeddings.ts) ───────

const JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings"
const JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small"
const JINA_EMBEDDING_DIMENSIONS = 1024
const CURRENT_ITEM_EMBEDDING_MODEL = `${JINA_EMBEDDING_MODEL}:notes-v3`

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function flagValue(name) {
  const index = args.indexOf(name)
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null
}

const DRY_RUN = args.includes("--dry-run")
const BATCH_SIZE = Math.min(Math.max(Number(flagValue("--batch-size")) || 50, 1), 2048)
const SINGLE_USER_ID = flagValue("--user") ? Number(flagValue("--user")) : null

// ─── Environment ─────────────────────────────────────────────────────────────

const connectionString = process.env.DB_ITEMS_URL ?? process.env.DB_NOTES_URL
if (!connectionString) {
  throw new Error("DB_ITEMS_URL is required (DB_NOTES_URL remains supported).")
}

const jinaApiKey = process.env.JINA_API_KEY?.trim()
if (!jinaApiKey) {
  throw new Error("JINA_API_KEY environment variable is required.")
}

// ─── Text normalization (mirrors services/item-embeddings.ts) ───────────────

function normalizeText(value) {
  if (typeof value !== "string") return ""
  return value.replace(/\r\n/g, "\n").trim()
}

// ─── Jina embedding fetch ───────────────────────────────────────────────────

/**
 * @param {string[]} inputs
 * @param {"retrieval.query" | "retrieval.passage"} task
 */
async function fetchEmbeddings(inputs, task) {
  if (inputs.length === 0) return []

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
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Jina error (${response.status}): ${payload?.detail ?? "unknown"}`)
  }

  if (!payload?.data || payload.data.length !== inputs.length) {
    throw new Error("Jina returned an unexpected embeddings payload.")
  }

  return [...payload.data]
    .sort((left, right) => left.index - right.index)
    .map((item) => {
      if (item.embedding.length !== JINA_EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Expected ${JINA_EMBEDDING_DIMENSIONS} dimensions, got ${item.embedding.length}.`,
        )
      }
      return item.embedding
    })
}

// ─── Database helpers ────────────────────────────────────────────────────────

const client = new Client({ connectionString })
await client.connect()

async function getUserIds() {
  if (SINGLE_USER_ID !== null) {
    return [SINGLE_USER_ID]
  }

  const { rows } = await client.query("SELECT id FROM public.user_v1 ORDER BY id")
  return rows.map((r) => r.id)
}

async function getTagsForUser(userId) {
  const { rows } = await client.query(
    `SELECT t.id, t.label
     FROM public.workspace_tag_v1 t
     JOIN public.user_workspace_v1 w ON w.id = t.workspace_id
     WHERE w.user_id = $1
       AND NULLIF(btrim(t.label), '') IS NOT NULL
     ORDER BY t.id`,
    [userId],
  )
  return rows
}

async function getCategoriesForUser(userId) {
  const { rows } = await client.query(
    `SELECT c.id, c.label
     FROM public.workspace_category_v1 c
     JOIN public.user_workspace_v1 w ON w.id = c.workspace_id
     WHERE w.user_id = $1
       AND NULLIF(btrim(c.label), '') IS NOT NULL
     ORDER BY c.id`,
    [userId],
  )
  return rows
}

async function getItemsForUser(userId) {
  const { rows } = await client.query(
    `SELECT n.id, n.description
     FROM public.workspace_item_v1 n
     JOIN public.user_workspace_v1 w ON w.id = n.workspace_id
     WHERE w.user_id = $1
       AND NULLIF(btrim(n.description), '') IS NOT NULL
     ORDER BY n.id`,
    [userId],
  )
  return rows
}

// ─── Regeneration logic ──────────────────────────────────────────────────────

async function regenerateTags(userId, tags) {
  if (tags.length === 0) return 0

  let updated = 0
  const now = new Date().toISOString()

  for (let i = 0; i < tags.length; i += BATCH_SIZE) {
    const batch = tags.slice(i, i + BATCH_SIZE)
    const texts = batch.map((c) => normalizeText(c.label))
    const nonEmpty = batch
      .map((c, idx) => ({ ...c, text: texts[idx] }))
      .filter((c) => c.text !== "")

    if (nonEmpty.length === 0) continue

    const embeddings = await fetchEmbeddings(
      nonEmpty.map((c) => c.text),
      "retrieval.passage",
    )

    for (let j = 0; j < nonEmpty.length; j++) {
      const cat = nonEmpty[j]
      const vectorLiteral = JSON.stringify(embeddings[j])

      if (DRY_RUN) {
        console.log(`  [dry-run] tag ${cat.id} "${cat.label}" → embedding`)
      } else {
        await client.query(
          `UPDATE public.workspace_tag_v1 t
           SET tag_embedding = $1::vector,
               embedding_model = $2,
               embedding_updated_at = $3
           FROM public.user_workspace_v1 w
           WHERE t.id = $4
             AND w.id = t.workspace_id
             AND w.user_id = $5`,
          [vectorLiteral, CURRENT_ITEM_EMBEDDING_MODEL, now, cat.id, userId],
        )
      }

      updated++
    }
  }

  return updated
}

async function regenerateCategories(userId, categories) {
  if (categories.length === 0) return 0

  let updated = 0
  const now = new Date().toISOString()

  for (let i = 0; i < categories.length; i += BATCH_SIZE) {
    const batch = categories.slice(i, i + BATCH_SIZE)
    const nonEmpty = batch
      .map((category) => ({ ...category, text: normalizeText(category.label) }))
      .filter((category) => category.text !== "")

    if (nonEmpty.length === 0) continue

    const embeddings = await fetchEmbeddings(
      nonEmpty.map((category) => category.text),
      "retrieval.passage",
    )

    for (let j = 0; j < nonEmpty.length; j++) {
      const category = nonEmpty[j]
      const vectorLiteral = JSON.stringify(embeddings[j])

      if (DRY_RUN) {
        console.log(`  [dry-run] category ${category.id} "${category.label}" → embedding`)
      } else {
        await client.query(
          `UPDATE public.workspace_category_v1 c
           SET category_embedding = $1::vector,
               embedding_model = $2,
               embedding_updated_at = $3
           FROM public.user_workspace_v1 w
           WHERE c.id = $4
             AND w.id = c.workspace_id
             AND w.user_id = $5`,
          [vectorLiteral, CURRENT_ITEM_EMBEDDING_MODEL, now, category.id, userId],
        )
      }

      updated++
    }
  }

  return updated
}

async function regenerateItems(userId, items) {
  if (items.length === 0) return 0

  let updated = 0
  const now = new Date().toISOString()

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const texts = batch.map((n) => normalizeText(n.description))
    const nonEmpty = batch
      .map((n, idx) => ({ ...n, text: texts[idx] }))
      .filter((n) => n.text !== "")

    if (nonEmpty.length === 0) continue

    const embeddings = await fetchEmbeddings(
      nonEmpty.map((n) => n.text),
      "retrieval.passage",
    )

    for (let j = 0; j < nonEmpty.length; j++) {
      const item = nonEmpty[j]
      const vectorLiteral = JSON.stringify(embeddings[j])

      if (DRY_RUN) {
        const desc = (item.description || "").slice(0, 40)
        console.log(`  [dry-run] item ${item.id} "${desc}…" → embedding`)
      } else {
        await client.query(
          `UPDATE public.workspace_item_v1 n
           SET description_embedding = $1::vector,
               embedding_model = $2,
               embedding_updated_at = $3
           FROM public.user_workspace_v1 w
           WHERE n.id = $4
             AND w.id = n.workspace_id
             AND w.user_id = $5`,
          [vectorLiteral, CURRENT_ITEM_EMBEDDING_MODEL, now, item.id, userId],
        )
      }

      updated++
    }
  }

  return updated
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(
  `Regenerating embeddings (model: ${CURRENT_ITEM_EMBEDDING_MODEL}, batch: ${BATCH_SIZE}${DRY_RUN ? ", DRY RUN" : ""})`,
)

const userIds = await getUserIds()
let totalCategories = 0
let totalTags = 0
let totalItems = 0

for (const userId of userIds) {
  const categories = await getCategoriesForUser(userId)
  const tags = await getTagsForUser(userId)
  const items = await getItemsForUser(userId)

  console.log(
    `User ${userId}: ${categories.length} categories, ${tags.length} tags, ${items.length} items`,
  )

  const categoryUpdated = await regenerateCategories(userId, categories)
  totalCategories += categoryUpdated

  const tagUpdated = await regenerateTags(userId, tags)
  totalTags += tagUpdated

  const itemUpdated = await regenerateItems(userId, items)
  totalItems += itemUpdated

  console.log(`  → ${categoryUpdated} categories, ${tagUpdated} tags, ${itemUpdated} items updated`)
}

console.log(
  `\nDone. ${totalCategories} categories, ${totalTags} tags, ${totalItems} items ${DRY_RUN ? "would be " : ""}updated across ${userIds.length} user(s).`,
)

await client.end()
