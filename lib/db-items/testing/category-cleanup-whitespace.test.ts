import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { adaptHistoricalMigration } from "./historical-migration"
import { getDb } from "../lib/db/postgres"
import { getCategoryNameError } from "../contracts/category-name"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

// ECMAScript WhiteSpace + LineTerminator, including every Space_Separator.
const trimCharacters = [
  ...[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680],
  ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
].map((point) => String.fromCodePoint(point))

describe("reserved category whitespace cleanup (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  for (const alreadyApplied of [false, true]) {
    test(`normalizes reserved names with original cleanup ${alreadyApplied ? "already applied" : "pending"}`, async () => {
      const client = await getDb().connect()
      try {
        await client.query("BEGIN")
        // Serialize with other DB tests; all fixtures and DDL are rolled back.
        await client.query(
          `ALTER TABLE public.workspace_category_v1 DROP CONSTRAINT workspace_category_v1_label_not_reserved_check`,
        )
        const originalMigration = await readFile(
          new URL("../migrations/202610182100__retire_default_category.sql", import.meta.url),
          "utf8",
        )
        if (alreadyApplied) await client.query(adaptHistoricalMigration(originalMigration))
        const userId = (
          await client.query<{ id: number }>(
            `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id`,
            [`trim-cleanup-${randomUUID()}`],
          )
        ).rows[0]!.id
        const workspaceIds = (
          await client.query<{ id: number }>(
            `INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'personal'),($1,'work') RETURNING id`,
            [userId],
          )
        ).rows.map((row) => row.id)
        const keepLabels = [
          "renamed default",
          "uncategorized ideas",
          "\tuncategorized ideas\t",
          "\u0085uncategorized\u0085", // ECMAScript does not trim NEL or ZWSP.
          "\u200buncategorized\u200b",
        ]
        const keptIds: number[] = []
        for (const label of keepLabels) {
          assert.equal(getCategoryNameError(label), null)
          keptIds.push(
            (
              await client.query<{ id: number }>(
                `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2) RETURNING id`,
                [workspaceIds[0], label],
              )
            ).rows[0]!.id,
          )
        }
        const reservedIds: number[] = []
        // Ordinary-space padding is already rejected by the old normalization
        // CHECK. Every other trim character is accepted by that old CHECK.
        const legacyLabels = trimCharacters
          .filter((character) => character !== " ")
          .map((character) => `${character}uncategorized${character}`)
        if (!alreadyApplied) legacyLabels.push("uncategorized")
        for (const [index, label] of legacyLabels.entries()) {
          assert.ok(getCategoryNameError(label))
          reservedIds.push(
            (
              await client.query<{ id: number }>(
                `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2) RETURNING id`,
                [workspaceIds[index % 2], label],
              )
            ).rows[0]!.id,
          )
        }
        const itemIds: number[] = []
        for (const workspaceId of workspaceIds) {
          itemIds.push(
            (
              await client.query<{ id: number }>(
                `INSERT INTO public.workspace_item_v1(workspace_id,description,time_created,time_modified)
                 VALUES($1,'whitespace legacy membership','2020-01-01','2021-01-01') RETURNING id`,
                [workspaceId],
              )
            ).rows[0]!.id,
          )
        }
        for (const [index, categoryId] of reservedIds.entries()) {
          await client.query(
            `INSERT INTO public.item_category_link_v1(item_id,category_id,workspace_id) VALUES($1,$2,$3)`,
            [itemIds[index % 2], categoryId, workspaceIds[index % 2]],
          )
        }
        for (const categoryId of keptIds) {
          await client.query(
            `INSERT INTO public.item_category_link_v1(item_id,category_id,workspace_id) VALUES($1,$2,$3)`,
            [itemIds[0], categoryId, workspaceIds[0]],
          )
        }
        const tagId = (
          await client.query<{ id: number }>(
            `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,$2) RETURNING id`,
            [workspaceIds[0], "\tuncategorized\t"],
          )
        ).rows[0]!.id
        await client.query(
          `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$3)`,
          [itemIds[0], tagId, workspaceIds[0]],
        )
        const beforeItems = (
          await client.query(
            `SELECT * FROM public.workspace_item_v1 WHERE id=ANY($1::int[]) ORDER BY id`,
            [itemIds],
          )
        ).rows
        const beforeTags = (
          await client.query(`SELECT * FROM public.item_tag_link_v1 WHERE item_id=ANY($1::int[])`, [
            itemIds,
          ])
        ).rows
        if (!alreadyApplied) await client.query(adaptHistoricalMigration(originalMigration))
        const correction = await readFile(
          new URL(
            "../migrations/202610192200__normalize_reserved_category_name.sql",
            import.meta.url,
          ),
          "utf8",
        )
        await client.query(adaptHistoricalMigration(correction))

        assert.deepEqual(
          (
            await client.query(
              `SELECT * FROM public.workspace_item_v1 WHERE id=ANY($1::int[]) ORDER BY id`,
              [itemIds],
            )
          ).rows,
          beforeItems,
        )
        assert.deepEqual(
          (
            await client.query(
              `SELECT * FROM public.item_tag_link_v1 WHERE item_id=ANY($1::int[])`,
              [itemIds],
            )
          ).rows,
          beforeTags,
        )
        assert.deepEqual(
          (
            await client.query(
              `SELECT category_id FROM public.item_category_link_v1 WHERE item_id=ANY($1::int[]) ORDER BY category_id`,
              [itemIds],
            )
          ).rows.map((row) => row.category_id),
          keptIds,
        )
        assert.deepEqual(
          (
            await client.query(
              `SELECT label FROM public.workspace_category_v1 WHERE workspace_id=ANY($1::int[]) ORDER BY id`,
              [workspaceIds],
            )
          ).rows.map((row) => row.label),
          keepLabels,
        )
        for (const label of [
          "uncategorized",
          ...trimCharacters.map((character) => `${character}uncategorized${character}`),
          "\t \nuncategorized\u00a0\ufeff",
          " UnCaTeGoRiZeD ",
        ]) {
          for (const sql of [
            `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2)`,
            `UPDATE public.workspace_category_v1 SET label=$2 WHERE workspace_id=$1 AND id=${keptIds[0]}`,
          ]) {
            await client.query("SAVEPOINT rejected_name")
            await assert.rejects(client.query(sql, [workspaceIds[0], label]), { code: "23514" })
            await client.query("ROLLBACK TO SAVEPOINT rejected_name")
          }
        }
      } finally {
        await client.query("ROLLBACK")
        client.release()
      }
    })
  }
})
