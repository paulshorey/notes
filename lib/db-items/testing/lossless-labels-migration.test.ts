import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import { Client } from "pg"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
const migration = "202611061200__lossless_labels.sql"

/** Create a scratch database migrated to just before the label-key migration. */
const withPreMigrationDatabase = async (work: (client: Client, url: string) => Promise<void>) => {
  const name = `lossless_labels_${randomUUID().replaceAll("-", "")}`
  const admin = new Client({ connectionString: testDbUrl })
  await admin.connect()
  const target = new URL(testDbUrl!)
  target.pathname = `/${name}`
  const client = new Client({ connectionString: target.toString() })
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`)
    await client.connect()
    const directory = new URL("../migrations/", import.meta.url)
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
    for (const file of files.filter((file) => file < migration))
      await client.query(await readFile(new URL(file, directory), "utf8"))
    await work(client, target.toString())
  } finally {
    await client.end().catch(() => {})
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
  }
}

const applyMigration = async (client: Client) =>
  client.query(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"))

test(
  "existing labels gain keys in place; legacy padding is trimmed; links are preserved",
  { skip: !testDbUrl },
  async () => {
    await withPreMigrationDatabase(async (client) => {
      const userId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_v1(username) VALUES('owner') RETURNING id",
        )
      ).rows[0]!.id
      const workspaceId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'personal') RETURNING id",
          [userId],
        )
      ).rows[0]!.id
      // The old lowercase CHECK only stripped ASCII spaces, so tab/NBSP padding exists.
      const tagId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,E'\\tidea\\u00a0') RETURNING id",
          [workspaceId],
        )
      ).rows[0]!.id
      const itemId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.workspace_item_v1(workspace_id,description) VALUES($1,'kept') RETURNING id",
          [workspaceId],
        )
      ).rows[0]!.id
      await client.query(
        "INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$3)",
        [itemId, tagId, workspaceId],
      )

      // The previous checks accepted compatibility forms of the reserved name.
      const reservedId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'ｕｎｃａｔｅｇｏｒｉｚｅｄ') RETURNING id",
          [workspaceId],
        )
      ).rows[0]!.id
      await client.query(
        "INSERT INTO public.item_category_link_v1(item_id,category_id,workspace_id) VALUES($1,$2,$3)",
        [itemId, reservedId, workspaceId],
      )

      await applyMigration(client)

      const reserved = await client.query(
        "SELECT 1 FROM public.workspace_category_v1 WHERE id=$1",
        [reservedId],
      )
      assert.equal(reserved.rowCount, 0)
      const item = await client.query<{ description: string }>(
        "SELECT description FROM public.workspace_item_v1 WHERE id=$1",
        [itemId],
      )
      assert.equal(item.rows[0]!.description, "kept")

      const tag = await client.query<{ label: string; label_key: string }>(
        "SELECT label,label_key FROM public.workspace_tag_v1 WHERE id=$1",
        [tagId],
      )
      assert.deepEqual(tag.rows[0], { label: "idea", label_key: "idea" })
      const links = await client.query(
        "SELECT 1 FROM public.item_tag_link_v1 WHERE item_id=$1 AND tag_id=$2",
        [itemId, tagId],
      )
      assert.equal(links.rowCount, 1)
      // During the rollout every write is stored lowercased for previous-release servers.
      const nycId = (
        await client.query<{ id: number; label: string }>(
          "INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'ＮＹＣ') RETURNING id,label",
          [workspaceId],
        )
      ).rows[0]!
      assert.equal(nycId.label, "ｎｙｃ")
      await client.query("UPDATE public.workspace_tag_v1 SET label='ＮＹＣ' WHERE id=$1", [
        nycId.id,
      ])
      const renamed = await client.query<{ label: string }>(
        "SELECT label FROM public.workspace_tag_v1 WHERE id=$1",
        [nycId.id],
      )
      assert.equal(renamed.rows[0]!.label, "ｎｙｃ")
      await assert.rejects(
        client.query("INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'nyc')", [
          workspaceId,
        ]),
        { code: "23505" },
      )
      // A previous-release server's insert of a compatibility form of an existing
      // label with the exact-label conflict target reuses the stored spelling.
      const legacyResolve = await client.query<{ id: number; label: string }>(
        `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'nyc')
         ON CONFLICT (workspace_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id,label`,
        [workspaceId],
      )
      assert.deepEqual(legacyResolve.rows[0], { id: nycId.id, label: "ｎｙｃ" })
      await client.query(
        `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'nyc')
         ON CONFLICT (workspace_id,label) DO NOTHING`,
        [workspaceId],
      )
      // Servers still running the previous release keep their conflict target.
      await client.query(
        `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'idea')
         ON CONFLICT(workspace_id,label) DO NOTHING`,
        [workspaceId],
      )
    })
  },
)

test(
  "labels that collide after trimming and normalization stop the migration",
  { skip: !testDbUrl },
  async () => {
    await withPreMigrationDatabase(async (client) => {
      const userId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_v1(username) VALUES('owner') RETURNING id",
        )
      ).rows[0]!.id
      const workspaceId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'personal') RETURNING id",
          [userId],
        )
      ).rows[0]!.id
      await client.query(
        "INSERT INTO public.workspace_status_v1(workspace_id,label,position) VALUES($1,'todo',1),($1,E'todo\\t',2)",
        [workspaceId],
      )
      await assert.rejects(applyMigration(client), /lossless_labels: 1 label/)
    })
  },
)

test(
  "concurrent inserts of one label key from both releases do not fail",
  { skip: !testDbUrl },
  async () => {
    await withPreMigrationDatabase(async (client, url) => {
      await applyMigration(client)
      const userId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_v1(username) VALUES('owner') RETURNING id",
        )
      ).rows[0]!.id
      const workspaceId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'personal') RETURNING id",
          [userId],
        )
      ).rows[0]!.id
      const other = new Client({ connectionString: url })
      await other.connect()
      try {
        // A current-release insert holds the key while a previous-release insert of a
        // compatibility form waits on the same key, then reuses the committed row.
        await client.query("BEGIN")
        const created = await client.query<{ id: number }>(
          "INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'ｎｙｃ') RETURNING id",
          [workspaceId],
        )
        const legacy = other.query<{ id: number }>(
          `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'nyc')
           ON CONFLICT (workspace_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
          [workspaceId],
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
        await client.query("COMMIT")
        assert.equal((await legacy).rows[0]!.id, created.rows[0]!.id)
      } finally {
        await other.end()
      }
    })
  },
)
