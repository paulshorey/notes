import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
const packageDir = fileURLToPath(new URL("../", import.meta.url))
const MIGRATION = "202611160300__single_category_and_subcategory.sql"

/** The migration runs against a populated database shaped as it was before it. */
test(
  "the single-category migration keeps one category per item and changes nothing else",
  { skip: !testDbUrl },
  async () => {
    const admin = new Client({ connectionString: testDbUrl })
    await admin.connect()
    const name = `single_category_${randomUUID().replaceAll("-", "")}`
    const url = new URL(testDbUrl!)
    url.pathname = `/${name}`
    const db = new Client({ connectionString: url.toString() })
    try {
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`)
      await db.connect()
      const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
        cwd: packageDir,
        encoding: "utf8",
        env: { ...process.env, DB_ITEMS_URL: url.toString() },
      })
      assert.equal(migrated.status, 0, migrated.stderr)

      // Return the schema to its shape before this migration, then populate it.
      await db.query(`
        ALTER TABLE public.workspace_item_v1 DROP COLUMN subcategory_id, DROP COLUMN category_id;
        DROP TABLE public.workspace_subcategory_v1;
        INSERT INTO public.user_v1(id,username) OVERRIDING SYSTEM VALUE VALUES(1,'migration');
        INSERT INTO public.user_workspace_v1(id,user_id,label) VALUES(10,1,'personal'),(11,1,'work');
        INSERT INTO public.workspace_category_v1(id,workspace_id,label,time_created,time_modified)
        VALUES(20,10,'newest','2024-01-01','2024-01-01'),
              (21,10,'oldest','2020-01-01','2020-01-01'),
              (22,10,'middle','2022-01-01','2022-01-01'),
              (23,10,'twin a','2021-06-01','2021-06-01'),
              (24,10,'twin b','2021-06-01','2021-06-01'),
              (25,11,'elsewhere','2019-01-01','2019-01-01');
        INSERT INTO public.workspace_status_v1(id,workspace_id,label,position) VALUES(30,10,'todo',1);
        INSERT INTO public.workspace_tag_v1(id,workspace_id,label) VALUES(40,10,'important');
        INSERT INTO public.workspace_item_v1(id,workspace_id,status_id,description,time_due,time_created,time_modified)
        VALUES(50,10,30,'in three categories','2027-02-03','2020-01-02','2021-02-03'),
              (51,10,NULL,'in one category',NULL,'2020-01-02','2021-02-03'),
              (52,10,NULL,'uncategorized',NULL,'2020-01-02','2021-02-03'),
              (53,10,NULL,NULL,'2028-01-02','2020-01-02','2021-02-03'),
              (54,11,NULL,'other workspace',NULL,'2020-01-02','2021-02-03');
        INSERT INTO public.item_category_link_v1(item_id,category_id,workspace_id)
        VALUES(50,20,10),(50,22,10),(50,21,10),(51,22,10),(53,24,10),(53,23,10),(54,25,11);
        INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES(50,40,10);
      `)
      const itemsBefore = (
        await db.query(
          `SELECT id,workspace_id,status_id,description,time_due,time_remind,time_created,time_modified
           FROM public.workspace_item_v1 ORDER BY id`,
        )
      ).rows
      const linksBefore = (
        await db.query(`SELECT * FROM public.item_category_link_v1 ORDER BY item_id,category_id`)
      ).rows
      const tagLinksBefore = (await db.query(`SELECT * FROM public.item_tag_link_v1`)).rows

      await db.query("BEGIN")
      await db.query(await readFile(new URL(`../migrations/${MIGRATION}`, import.meta.url), "utf8"))
      await db.query("COMMIT")

      const filed = (
        await db.query<{ id: number; category_id: number | null; subcategory_id: number | null }>(
          `SELECT id,category_id,subcategory_id FROM public.workspace_item_v1 ORDER BY id`,
        )
      ).rows
      assert.deepEqual(filed, [
        // Several categories: the oldest-created one is kept.
        { id: 50, category_id: 21, subcategory_id: null },
        { id: 51, category_id: 22, subcategory_id: null },
        { id: 52, category_id: null, subcategory_id: null },
        // Equal creation times fall back to the lower category id.
        { id: 53, category_id: 23, subcategory_id: null },
        { id: 54, category_id: 25, subcategory_id: null },
      ])
      // Filing is not an edit: text, dates, status, and both timestamps are untouched.
      assert.deepEqual(
        (
          await db.query(
            `SELECT id,workspace_id,status_id,description,time_due,time_remind,time_created,time_modified
             FROM public.workspace_item_v1 ORDER BY id`,
          )
        ).rows,
        itemsBefore,
      )
      assert.deepEqual(
        (await db.query(`SELECT * FROM public.item_tag_link_v1`)).rows,
        tagLinksBefore,
      )
      // The previous release still reads the link table during a deploy.
      assert.deepEqual(
        (await db.query(`SELECT * FROM public.item_category_link_v1 ORDER BY item_id,category_id`))
          .rows,
        linksBefore,
      )
      assert.equal(
        (await db.query(`SELECT COUNT(*)::int n FROM public.workspace_category_v1`)).rows[0].n,
        6,
      )

      // The timestamp trigger is back on after the backfill.
      await db.query(`UPDATE public.workspace_item_v1 SET description='edited' WHERE id=52`)
      assert.notDeepEqual(
        (await db.query(`SELECT time_modified FROM public.workspace_item_v1 WHERE id=52`)).rows[0]
          .time_modified,
        itemsBefore[2]!.time_modified,
      )

      // The database enforces the hierarchy on the populated tables.
      await db.query(
        `INSERT INTO public.workspace_subcategory_v1(id,category_id,label) VALUES(60,21,'ideas'),(61,22,'ideas')`,
      )
      await db.query(`UPDATE public.workspace_item_v1 SET subcategory_id=60 WHERE id=50`)
      for (const [statement, code] of [
        // A subcategory of another category.
        [`UPDATE public.workspace_item_v1 SET subcategory_id=61 WHERE id=50`, "23503"],
        // A subcategory without a category.
        [`UPDATE public.workspace_item_v1 SET category_id=NULL WHERE id=50`, "23514"],
        // A category of another workspace.
        [`UPDATE public.workspace_item_v1 SET category_id=25 WHERE id=51`, "23503"],
        // The same subcategory label twice in one category.
        [
          `INSERT INTO public.workspace_subcategory_v1(category_id,label) VALUES(21,'ideas')`,
          "23505",
        ],
        // A category or subcategory that still files an item.
        [`DELETE FROM public.workspace_subcategory_v1 WHERE id=60`, "23503"],
        [`DELETE FROM public.workspace_category_v1 WHERE id=21`, "23503"],
      ] as const)
        await assert.rejects(db.query(statement), { code }, statement)
      // Moving a subcategory to another category moves its items with it.
      await db.query(`UPDATE public.workspace_subcategory_v1 SET category_id=20 WHERE id=60`)
      assert.deepEqual(
        (
          await db.query(
            `SELECT category_id,subcategory_id FROM public.workspace_item_v1 WHERE id=50`,
          )
        ).rows[0],
        { category_id: 20, subcategory_id: 60 },
      )
      // Deleting a workspace still removes its items, categories, and subcategories.
      await db.query(`DELETE FROM public.user_workspace_v1 WHERE id=10`)
      assert.deepEqual(
        (
          await db.query(
            `SELECT (SELECT COUNT(*)::int FROM public.workspace_item_v1) items,
                    (SELECT COUNT(*)::int FROM public.workspace_category_v1) categories,
                    (SELECT COUNT(*)::int FROM public.workspace_subcategory_v1) subcategories`,
          )
        ).rows[0],
        { items: 1, categories: 1, subcategories: 0 },
      )
    } finally {
      await db.end().catch(() => undefined)
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    }
  },
)
