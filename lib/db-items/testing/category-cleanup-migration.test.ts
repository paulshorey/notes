import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { adaptHistoricalMigration } from "./historical-migration"
import { getDb } from "../lib/db/postgres"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("retiring the literal category (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  test("migration removes only legacy memberships, preserves note data, and reserves the name", async () => {
    const client = await getDb().connect()
    try {
      await client.query("BEGIN")
      // Recreate the pre-migration state transactionally. The table lock keeps
      // other test processes from observing a temporarily relaxed constraint.
      await client.query(
        `ALTER TABLE public.workspace_category_v1 DROP CONSTRAINT workspace_category_v1_label_not_reserved_check`,
      )
      const userId = (
        await client.query<{ id: number }>(
          `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id`,
          [`migration-${randomUUID()}`],
        )
      ).rows[0]!.id
      const workspaceIds = (
        await client.query<{ id: number }>(
          `INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'personal'),($1,'work') RETURNING id`,
          [userId],
        )
      ).rows.map((row) => row.id)
      const categories = (
        await client.query<{ id: number; label: string; workspace_id: number }>(
          `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'renamed default'),($1,'uncategorized'),($1,'project'),($2,'uncategorized') RETURNING id,label,workspace_id`,
          workspaceIds,
        )
      ).rows
      const renamedId = categories[0]!.id
      const legacyId = categories[1]!.id
      const projectId = categories[2]!.id
      const otherLegacyId = categories[3]!.id
      const statusId = (
        await client.query<{ id: number }>(
          `INSERT INTO public.workspace_status_v1(workspace_id,label) VALUES($1,'todo') RETURNING id`,
          [workspaceIds[0]],
        )
      ).rows[0]!.id
      const tagId = (
        await client.query<{ id: number }>(
          `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'uncategorized') RETURNING id`,
          [workspaceIds[0]],
        )
      ).rows[0]!.id
      const itemIds = (
        await client.query<{ id: number }>(
          `INSERT INTO public.workspace_item_v1(workspace_id,status_id,description,time_created,time_modified,time_due)
         VALUES($1,$3,'legacy only','2020-01-01','2021-01-01','2027-01-01'),
               ($1,NULL,'mixed','2020-01-02','2021-01-02',NULL),
               ($1,NULL,'already empty','2020-01-03','2021-01-03',NULL),
               ($1,NULL,'renamed default','2020-01-04','2021-01-04',NULL),
               ($2,NULL,'other workspace','2020-01-05','2021-01-05',NULL) RETURNING id`,
          [workspaceIds[0], workspaceIds[1], statusId],
        )
      ).rows.map((row) => row.id)
      for (const link of [
        [itemIds[0], legacyId, workspaceIds[0]],
        [itemIds[1], legacyId, workspaceIds[0]],
        [itemIds[1], projectId, workspaceIds[0]],
        [itemIds[3], renamedId, workspaceIds[0]],
        [itemIds[4], otherLegacyId, workspaceIds[1]],
      ]) {
        await client.query(
          `INSERT INTO public.item_category_link_v1(item_id,category_id,workspace_id) VALUES($1,$2,$3)`,
          link,
        )
      }
      await client.query(
        `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$3)`,
        [itemIds[0], tagId, workspaceIds[0]],
      )
      const before = await client.query(
        `SELECT * FROM public.workspace_item_v1 WHERE id=ANY($1::int[]) ORDER BY id`,
        [itemIds],
      )
      const beforeTags = await client.query(
        `SELECT * FROM public.item_tag_link_v1 WHERE item_id=ANY($1::int[]) ORDER BY item_id,tag_id`,
        [itemIds],
      )

      const migration = await readFile(
        new URL("../migrations/202610182100__retire_default_category.sql", import.meta.url),
        "utf8",
      )
      await client.query(adaptHistoricalMigration(migration))

      assert.deepEqual(
        (
          await client.query(
            `SELECT * FROM public.workspace_item_v1 WHERE id=ANY($1::int[]) ORDER BY id`,
            [itemIds],
          )
        ).rows,
        before.rows,
      )
      assert.deepEqual(
        (
          await client.query(
            `SELECT * FROM public.item_tag_link_v1 WHERE item_id=ANY($1::int[]) ORDER BY item_id,tag_id`,
            [itemIds],
          )
        ).rows,
        beforeTags.rows,
      )
      assert.deepEqual(
        (
          await client.query(
            `SELECT item_id,category_id FROM public.item_category_link_v1 WHERE item_id=ANY($1::int[]) ORDER BY item_id`,
            [itemIds],
          )
        ).rows,
        [
          { item_id: itemIds[1], category_id: projectId },
          { item_id: itemIds[3], category_id: renamedId },
        ],
      )
      assert.deepEqual(
        (
          await client.query(
            `SELECT label FROM public.workspace_category_v1 WHERE workspace_id=ANY($1::int[]) ORDER BY id`,
            [workspaceIds],
          )
        ).rows.map((row) => row.label),
        ["renamed default", "project"],
      )

      for (const sql of [
        `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'uncategorized')`,
        `UPDATE public.workspace_category_v1 SET label='uncategorized' WHERE workspace_id=$1`,
      ]) {
        await client.query("SAVEPOINT rejected_name")
        await assert.rejects(client.query(sql, [workspaceIds[0]]), {
          code: "23514",
          constraint: "workspace_category_v1_label_not_reserved_check",
        })
        await client.query("ROLLBACK TO SAVEPOINT rejected_name")
      }
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })
})
