import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getCategoryNameError } from "../contracts/category-name"
import { labelKey, sameLabel } from "../contracts/label"
import { parseUserBackup } from "../contracts/user-backup"
import { getDb } from "../lib/db/postgres"
import { createTagForItemsApp, mergeAnonymousItemsAppSession } from "../services/items-app"
import { createItemForUser, listItemsByUser, parseItemInput } from "../sql/item"
import { resolveTagIdForWorkspace } from "../sql/item/shared"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { createWorkspaceForUser } from "../sql/workspace"
import { backupFixture } from "./user-backup-fixture"

test("label keys ignore case and Unicode compatibility forms", () => {
  assert.equal(labelKey("  Q3 Plan "), "q3 plan")
  assert.equal(labelKey("Ｑ３ Plan"), "q3 plan")
  assert.ok(sameLabel("NYC", "nyc"))
  assert.equal(getCategoryNameError("Uncategorized"), getCategoryNameError("uncategorized"))
  assert.notEqual(getCategoryNameError("Uncategorized"), null)
})

test("backups keep label casing and reject labels that collide by key", () => {
  const backup = backupFixture()
  const workspace = backup.workspaces[0]!
  workspace.tags = [{ ...workspace.tags[0]!, label: "iOS" }]
  workspace.items = workspace.items.map((item) => ({ ...item, tags: ["ios"] }))
  const parsed = parseUserBackup(backup)
  assert.equal(parsed.workspaces[0]!.tags[0]!.label, "iOS")
  workspace.tags = [workspace.tags[0]!, { ...workspace.tags[0]!, label: "IOS" }]
  assert.throws(() => parseUserBackup(backup), /duplicate labels/)
})

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("lossless text and labels (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    await getDb().end()
  })

  const createUser = async (anonymous = false) =>
    (
      await getDb().query<{ id: number }>(
        "INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,$2) RETURNING id",
        [`lossless-${randomUUID()}`, anonymous],
      )
    ).rows[0]!.id

  test("item text is stored exactly as typed; blank text is no text", async () => {
    const userId = await createUser(true)
    try {
      const workspace = await createWorkspaceForUser(userId, "Personal")
      const typed = "  indented code\n\n- list item  \n"
      const embedding = { descriptionEmbedding: null, embeddingModel: null }
      const item = await createItemForUser(
        userId,
        parseItemInput({ workspaceId: workspace.id, description: typed }),
        embedding,
      )
      assert.equal(item.description, typed)
      const blank = await createItemForUser(
        userId,
        parseItemInput({ workspaceId: workspace.id, description: " \n " }),
        embedding,
      )
      assert.equal(blank.description, null)
      const loaded = await listItemsByUser(userId, workspace.id)
      assert.equal(loaded.find((row) => row.id === item.id)!.description, typed)
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id=$1", [userId])
    }
  })

  test("labels keep their casing and are unique by key", async () => {
    const userId = await createUser(true)
    try {
      const workspace = await createWorkspaceForUser(userId, "Q3 Plan")
      assert.equal(workspace.label, "Q3 Plan")
      await assert.rejects(createWorkspaceForUser(userId, "q3 plan"), { code: "23505" })
      const client = await getDb().connect()
      try {
        const first = await resolveTagIdForWorkspace(client, workspace.id, " NYC ")
        const second = await resolveTagIdForWorkspace(client, workspace.id, "nyc")
        assert.equal(second, first)
        const { rows } = await client.query<{ label: string }>(
          "SELECT label FROM public.workspace_tag_v1 WHERE id=$1",
          [first],
        )
        assert.equal(rows[0]!.label, "NYC", "reusing a label must not rewrite its casing")
        await assert.rejects(
          client.query(
            "INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'UNCATEGORIZED')",
            [workspace.id],
          ),
          { code: "23514" },
        )
        await assert.rejects(
          client.query(
            "INSERT INTO public.workspace_status_v1(workspace_id,label,position) VALUES($1,' Todo',1)",
            [workspace.id],
          ),
          { code: "23514" },
        )
      } finally {
        client.release()
      }
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id=$1", [userId])
    }
  })

  test("SQL and client label keys agree regardless of database locale", async () => {
    const samples = ["NYC", "ÉCOLE", "İstanbul", "STRAẞE", "ΣΑΣ", "Ｑ３ Plan", "Ǆ", "ﬁle"]
    const { rows } = await getDb().query<{ key: string }>(
      "SELECT public.app_label_key_v1(value) AS key FROM unnest($1::text[]) WITH ORDINALITY u(value,n) ORDER BY n",
      [samples],
    )
    assert.deepEqual(
      rows.map((row) => row.key),
      samples.map(labelKey),
    )
  })

  test("reusing a label by key keeps the existing label's embedding", async () => {
    const userId = await createUser(true)
    const savedKey = process.env.JINA_API_KEY
    const savedFetch = globalThis.fetch
    process.env.JINA_API_KEY = "test-key"
    // Each spelling gets a distinguishable vector.
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const { input } = JSON.parse(init?.body ?? "{}") as { input: string[] }
      const fill = input[0] === "NYC" ? 0.25 : 0.75
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: Array(1024).fill(fill) }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch
    try {
      const workspace = await createWorkspaceForUser(userId, "Personal")
      const first = await createTagForItemsApp({ userId, workspaceId: workspace.id, label: "NYC" })
      const reused = await createTagForItemsApp({ userId, workspaceId: workspace.id, label: "nyc" })
      assert.equal(reused.tag.id, first.tag.id)
      assert.equal(reused.tag.label, "NYC")
      const { rows } = await getDb().query<{ value: number }>(
        "SELECT (tag_embedding::real[])[1] AS value FROM public.workspace_tag_v1 WHERE id=$1",
        [first.tag.id],
      )
      assert.equal(rows[0]!.value, 0.25)
    } finally {
      globalThis.fetch = savedFetch
      if (savedKey === undefined) delete process.env.JINA_API_KEY
      else process.env.JINA_API_KEY = savedKey
      await getDb().query("DELETE FROM public.user_v1 WHERE id=$1", [userId])
    }
  })

  test("anonymous merge and backup restore match labels by key", async () => {
    const realUserId = await createUser()
    const anon = await createAnonymousUser()
    try {
      const realWorkspace = await createWorkspaceForUser(realUserId, "Personal")
      await getDb().query(
        "INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'NYC')",
        [realWorkspace.id],
      )
      const anonWorkspaceId = (
        await getDb().query<{ id: number }>(
          "SELECT id FROM public.user_workspace_v1 WHERE user_id=$1 AND label_key='personal'",
          [anon.id],
        )
      ).rows[0]!.id
      const anonCategoryId = (
        await getDb().query<{ id: number }>(
          "INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'nyc') RETURNING id",
          [anonWorkspaceId],
        )
      ).rows[0]!.id
      await createItemForUser(
        anon.id,
        parseItemInput({
          workspaceId: anonWorkspaceId,
          categoryIds: [anonCategoryId],
          description: "Trip",
        }),
        { descriptionEmbedding: null, embeddingModel: null },
      )
      await mergeAnonymousItemsAppSession({ anonUserId: anon.id, realUserId })

      const workspaces = await getDb().query<{ label: string }>(
        "SELECT label FROM public.user_workspace_v1 WHERE user_id=$1",
        [realUserId],
      )
      assert.deepEqual(
        workspaces.rows.map((row) => row.label),
        ["Personal"],
      )
      const [item] = await listItemsByUser(realUserId, realWorkspace.id)
      assert.deepEqual(
        item!.categories.map((category) => category.label),
        ["NYC"],
      )

      const backup = await exportUserBackup(realUserId)
      assert.equal(backup.workspaces[0]!.label, "Personal")
      assert.deepEqual(backup.workspaces[0]!.items[0]!.categories, ["NYC"])
      const restored = await restoreUserBackup(realUserId, backup)
      assert.equal(restored.itemsImported, 0)
      assert.equal(restored.itemsSkipped, 1)
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id = ANY($1::int[])", [
        [realUserId, anon.id],
      ])
    }
  })
})
