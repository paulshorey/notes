import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { Client } from "pg"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
const root = fileURLToPath(new URL("../../../", import.meta.url))
const tables = [
  "user_v1",
  "user_api_token_v1",
  "user_workspace_v1",
  "workspace_item_v1",
  "workspace_category_v1",
  "workspace_status_v1",
  "workspace_tag_v1",
  "item_category_link_v1",
  "item_tag_link_v1",
  "schema_migrations_cursor",
]

// Every target is a new database on the explicit test cluster, never a runtime URL.
const fixture = async (
  run: (
    source: Client,
    target: Client,
    sourceUrl: string,
    targetUrl: string,
    folder: string,
  ) => Promise<void>,
) => {
  const admin = new Client({ connectionString: testDbUrl })
  await admin.connect()
  const names = ["source", "target"].map(
    (role) => `item_tools_${role}_${randomUUID().replaceAll("-", "")}`,
  )
  const urls = names.map((name) => {
    const url = new URL(testDbUrl!)
    url.pathname = `/${name}`
    return url.toString()
  })
  const source = new Client({ connectionString: urls[0] })
  const target = new Client({ connectionString: urls[1] })
  const folder = await mkdtemp(join(tmpdir(), "item-tools-test-"))
  try {
    for (const name of names)
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`)
    await source.connect()
    await target.connect()
    const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: join(root, "lib/db-items"),
      encoding: "utf8",
      env: { ...process.env, DB_ITEMS_URL: urls[0]! },
    })
    assert.equal(migration.status, 0, migration.stderr)
    await source.query(`
      INSERT INTO user_v1(id,username,preferences) OVERRIDING SYSTEM VALUE VALUES(11,'backup fixture','{"notesApp":{"maxOpenNotes":5}}');
      INSERT INTO user_workspace_v1(id,user_id,label) VALUES(21,11,'personal'),(22,11,'work');
      INSERT INTO workspace_category_v1(id,workspace_id,label) VALUES(31,21,'project'),(32,21,'unused');
      INSERT INTO workspace_status_v1(id,workspace_id,label,position) VALUES(41,21,'todo',3);
      INSERT INTO workspace_tag_v1(id,workspace_id,label) VALUES(51,21,'important');
      INSERT INTO workspace_item_v1(id,workspace_id,status_id,description,time_due,time_created,time_modified)
      VALUES(61,21,41,'Unicode 日本語 and trailing space ','2027-02-03','2020-01-02','2021-02-03'),(62,22,NULL,NULL,'2028-01-02','2020-01-02','2021-02-03');
      INSERT INTO item_category_link_v1(item_id,category_id,workspace_id) VALUES(61,31,21);
      INSERT INTO item_tag_link_v1(item_id,tag_id,workspace_id) VALUES(61,51,21);
      INSERT INTO user_api_token_v1(user_id,token_hash) VALUES(11,'fixture-only-hash');
    `)
    await source.query(
      "UPDATE workspace_item_v1 SET description_embedding=$1::vector WHERE id=61",
      [JSON.stringify([1, ...Array(1023).fill(0)])],
    )
    // UPDATE intentionally runs the timestamp trigger; capture its exact stored result.
    for (const table of tables.slice(0, 7))
      await source.query("SELECT setval(pg_get_serial_sequence($1,'id'),90000,true)", [
        `public.${table}`,
      ])
    await run(source, target, urls[0]!, urls[1]!, folder)
  } finally {
    await source.end()
    await target.end()
    for (const name of names) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.end()
    await rm(folder, { recursive: true, force: true })
  }
}

const script = (name: string, url: string, args: string[] = [], legacy = false) => {
  const env = { ...process.env }
  delete env.DB_ITEMS_URL
  delete env.DB_NOTES_URL
  env[legacy ? "DB_NOTES_URL" : "DB_ITEMS_URL"] = url
  return spawnSync("bash", [`scripts/db/items-${name}.sh`, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  })
}
const successful = (result: ReturnType<typeof script>) =>
  assert.equal(result.status, 0, result.stderr)
const dumpRows = async (client: Client) => {
  const result: Record<string, unknown> = {}
  for (const table of tables)
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) data FROM public.${table} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows
  return result
}
const makeBackup = (url: string, folder: string, legacy = false) => {
  const schema = join(folder, "schema.sql"),
    data = join(folder, "data.sql")
  successful(script("backup-schema", url, [schema], legacy))
  successful(script("backup-data", url, [data], legacy))
  return { schema, data }
}

test(
  "CLI backup restores all item rows, relationships, vectors, triggers, aliases and sequences into an empty database",
  { skip: !testDbUrl },
  async () => {
    await fixture(async (source, target, sourceUrl, targetUrl, folder) => {
      const before = await dumpRows(source)
      const { schema, data } = makeBackup(sourceUrl, folder, true)
      assert.match(await readFile(data, "utf8"), /COPY public\.workspace_item_v1/)
      assert.doesNotMatch(await readFile(data, "utf8"), /COPY public\.user_note_v1/)
      successful(script("restore-schema", targetUrl, ["-y", schema]))
      successful(script("restore-data", targetUrl, ["-y", data]))
      assert.deepEqual(await dumpRows(target), before)
      assert.equal(
        (
          await target.query(
            "SELECT count(*)::int n FROM information_schema.views WHERE table_schema='public' AND is_updatable='YES'",
          )
        ).rows[0]!.n,
        6,
      )
      const created = (
        await target.query(
          "INSERT INTO workspace_item_v1(workspace_id,description) VALUES(21,'after restore') RETURNING id,time_created,time_modified",
        )
      ).rows[0]!
      assert.equal(created.id, 90001)
      assert.ok(created.time_created)
      assert.ok(created.time_modified)
      await target.query("UPDATE workspace_item_v1 SET description='changed' WHERE id=61")
      assert.equal((await target.query("SELECT count(*)::int n FROM user_note_v1")).rows[0]!.n, 3)
      await assert.rejects(
        target.query(
          "INSERT INTO item_category_link_v1(item_id,category_id,workspace_id) VALUES(62,31,22)",
        ),
        /foreign key/,
      )
      // An already migrated destination must also replace/recreate its aliases.
      successful(script("restore-schema", targetUrl, ["-y", schema]))
      successful(script("restore-data", targetUrl, ["-y", data]))
      assert.deepEqual(await dumpRows(target), before)

      // A selected leaf relation carries its alias without copying parent tables.
      const leafSchema = join(folder, "links-schema.sql")
      const leafData = join(folder, "links-data.sql")
      successful(script("backup-schema", sourceUrl, ["-t", "item_tag_link_v1", leafSchema]))
      successful(script("backup-data", sourceUrl, ["-t", "item_tag_link_v1", leafData]))
      successful(script("restore-schema", targetUrl, ["-y", "-t", "item_tag_link_v1", leafSchema]))
      successful(script("restore-data", targetUrl, ["-y", "-t", "item_tag_link_v1", leafData]))
      assert.deepEqual(await dumpRows(target), before)
      assert.equal(
        (await target.query("SELECT count(*)::int n FROM user_note_tag_link_v1")).rows[0]!.n,
        1,
      )
      const after = await dumpRows(source)
      assert.deepEqual(after, before, "backup commands never mutate the source")
    })
  },
)

test(
  "CLI restore failure rolls back existing schema, data, aliases and ID sequence state",
  { skip: !testDbUrl },
  async () => {
    await fixture(async (source, _target, sourceUrl, _targetUrl, folder) => {
      const { schema, data } = makeBackup(sourceUrl, folder)
      await source.query(
        "UPDATE workspace_item_v1 SET description='newer than the backup' WHERE id=61",
      )
      await source.query("SELECT setval('public.user_note_v1_id_seq',91000,true)")
      const before = await dumpRows(source)
      const emptySchema = join(folder, "empty-schema.sql")
      await writeFile(emptySchema, "")
      assert.notEqual(script("restore-schema", sourceUrl, ["-y", emptySchema]).status, 0)
      const incompleteData = join(folder, "user-only-data.sql")
      successful(script("backup-data", sourceUrl, ["-t", "user_v1", incompleteData]))
      assert.notEqual(script("restore-data", sourceUrl, ["-y", incompleteData]).status, 0)
      assert.deepEqual(await dumpRows(source), before)
      const brokenData = join(folder, "broken-data.sql")
      await writeFile(brokenData, (await readFile(data, "utf8")) + "\nSELECT 1 / 0;\n")
      assert.notEqual(script("restore-data", sourceUrl, ["-y", brokenData]).status, 0)
      assert.deepEqual(await dumpRows(source), before)
      assert.equal(
        (await source.query("SELECT last_value FROM user_note_v1_id_seq")).rows[0]!.last_value,
        "91000",
      )
      const brokenSchema = join(folder, "broken-schema.sql")
      await writeFile(brokenSchema, (await readFile(schema, "utf8")) + "\nSELECT 1 / 0;\n")
      assert.notEqual(script("restore-schema", sourceUrl, ["-y", brokenSchema]).status, 0)
      assert.deepEqual(await dumpRows(source), before)
      assert.equal((await source.query("SELECT count(*)::int n FROM user_note_v1")).rows[0]!.n, 2)
    })
  },
)

test(
  "CLI partial restores refuse to cascade into unselected relationships or outside tables",
  { skip: !testDbUrl },
  async () => {
    await fixture(async (source, _target, sourceUrl, _targetUrl, folder) => {
      const { schema, data } = makeBackup(sourceUrl, folder)
      const before = await dumpRows(source)
      for (const kind of ["schema", "data"]) {
        const file = join(folder, `missing-${kind}.sql`)
        await writeFile(file, "existing backup must survive failed replacement")
        assert.notEqual(
          script(`backup-${kind}`, sourceUrl, [
            "-t",
            "workspace_item_v1",
            "-t",
            "missing_table",
            file,
          ]).status,
          0,
        )
        assert.equal(
          await readFile(file, "utf8"),
          "existing backup must survive failed replacement",
        )
      }
      const partialSchema = join(folder, "partial-schema.sql"),
        partialData = join(folder, "partial-data.sql")
      successful(script("backup-schema", sourceUrl, ["-t", "workspace_item_v1", partialSchema]))
      successful(script("backup-data", sourceUrl, ["-t", "workspace_item_v1", partialData]))
      assert.notEqual(
        script("restore-data", sourceUrl, ["-y", "-t", "workspace_item_v1", partialData]).status,
        0,
      )
      assert.deepEqual(await dumpRows(source), before)
      assert.notEqual(
        script("restore-schema", sourceUrl, ["-y", "-t", "workspace_item_v1", partialSchema])
          .status,
        0,
      )
      assert.deepEqual(await dumpRows(source), before)
      await source.query(
        "CREATE TABLE outside_items(id int PRIMARY KEY,item_id int REFERENCES workspace_item_v1(id)); INSERT INTO outside_items VALUES(1,61)",
      )
      for (const [kind, path] of [
        ["data", data],
        ["schema", schema],
      ] as const) {
        assert.notEqual(script(`restore-${kind}`, sourceUrl, ["-y", path]).status, 0)
        assert.deepEqual((await source.query("SELECT * FROM outside_items")).rows, [
          { id: 1, item_id: 61 },
        ])
        assert.deepEqual(await dumpRows(source), before)
      }
    })
  },
)
