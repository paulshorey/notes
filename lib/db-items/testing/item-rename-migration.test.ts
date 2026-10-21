import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import { Client } from "pg"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL

test(
  "a populated old schema upgrades in place and supports both server generations",
  { skip: !testDbUrl },
  async () => {
    const name = `item_rename_${randomUUID().replaceAll("-", "")}`
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
      const rename = "202610201800__rename_notes_to_items.sql"
      for (const file of files.filter((file) => file < rename)) {
        await client.query(await readFile(new URL(file, directory), "utf8"))
      }
      const userId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_v1(username) VALUES('preserved owner') RETURNING id",
        )
      ).rows[0]!.id
      const workspaceId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'personal') RETURNING id",
          [userId],
        )
      ).rows[0]!.id
      const categoryId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.workspace_note_category_v1(workspace_id,label) VALUES($1,'project') RETURNING id",
          [workspaceId],
        )
      ).rows[0]!.id
      const tagId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.workspace_note_tag_v1(workspace_id,label) VALUES($1,'important') RETURNING id",
          [workspaceId],
        )
      ).rows[0]!.id
      const itemId = (
        await client.query<{ id: number }>(
          `INSERT INTO public.user_note_v1(workspace_id,description,time_due,time_remind,time_created,time_modified)
       VALUES($1,'preserve 日本語 and trailing space ','2027-01-02','2027-01-01','2020-01-01','2021-01-01') RETURNING id`,
          [workspaceId],
        )
      ).rows[0]!.id
      await client.query(
        "INSERT INTO public.user_note_category_link_v1(note_id,category_id,workspace_id) VALUES($1,$2,$3)",
        [itemId, categoryId, workspaceId],
      )
      await client.query(
        "INSERT INTO public.user_note_tag_link_v1(note_id,tag_id,workspace_id) VALUES($1,$2,$3)",
        [itemId, tagId, workspaceId],
      )
      const before = (await client.query("SELECT * FROM public.user_note_v1 ORDER BY id")).rows
      const oid = (await client.query("SELECT 'public.user_note_v1'::regclass::oid oid")).rows[0]!
        .oid
      await client.query(
        "CREATE TABLE public.outside_item_core(id int CONSTRAINT outside_note_check CHECK(id > 0))",
      )
      await client.query(await readFile(new URL(rename, directory), "utf8"))
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int count FROM pg_constraint WHERE conname='outside_note_check'",
          )
        ).rows[0]!.count,
        1,
        "renaming item objects must not change unrelated tables with note-named constraints",
      )
      assert.equal(
        (await client.query("SELECT 'public.workspace_item_v1'::regclass::oid oid")).rows[0]!.oid,
        oid,
      )
      assert.deepEqual(
        (await client.query("SELECT * FROM public.workspace_item_v1 ORDER BY id")).rows,
        before,
      )
      assert.deepEqual(
        (await client.query("SELECT * FROM public.user_note_v1 ORDER BY id")).rows,
        before,
      )
      assert.deepEqual((await client.query("SELECT * FROM public.item_category_link_v1")).rows, [
        { item_id: itemId, category_id: categoryId, workspace_id: workspaceId },
      ])
      assert.deepEqual((await client.query("SELECT * FROM public.item_tag_link_v1")).rows, [
        { item_id: itemId, tag_id: tagId, workspace_id: workspaceId },
      ])
      // Exercise the old merge allocator and vocabulary upsert after renaming.
      const oldId = (
        await client.query<{ id: number }>("SELECT nextval('public.user_note_v1_id_seq')::int id")
      ).rows[0]!.id
      await client.query(
        "INSERT INTO public.user_note_v1(id,workspace_id,description) VALUES($1,$2,'old server')",
        [oldId, workspaceId],
      )
      await client.query(
        `INSERT INTO public.workspace_note_category_v1(workspace_id,label) VALUES($1,'project') ON CONFLICT(workspace_id,label) DO UPDATE SET label=EXCLUDED.label`,
        [workspaceId],
      )
      await client.query(
        "INSERT INTO public.user_note_category_link_v1(note_id,category_id,workspace_id) VALUES($1,$2,$3)",
        [oldId, categoryId, workspaceId],
      )
      const newId = (
        await client.query<{ id: number }>(
          "INSERT INTO public.workspace_item_v1(workspace_id,description) VALUES($1,NULL) RETURNING id",
          [workspaceId],
        )
      ).rows[0]!.id
      assert.ok(newId > oldId, "old and new writers share one ID allocator")
      assert.equal(
        (await client.query("SELECT description FROM public.user_note_v1 WHERE id=$1", [newId]))
          .rows[0]!.description,
        null,
      )
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int count FROM public.item_category_link_v1 WHERE category_id=$1",
            [categoryId],
          )
        ).rows[0]!.count,
        2,
      )
    } finally {
      await client.end()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    }
  },
)
