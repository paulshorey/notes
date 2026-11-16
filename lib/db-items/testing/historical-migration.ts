import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { Client } from "pg"

const migrations = new URL("../migrations/", import.meta.url)

/**
 * Run a test against the schema as it was just before one migration.
 *
 * A throwaway database on the test cluster gets every earlier migration, in order.
 * `run` receives a client for it and `apply`, which executes a migration file as the
 * runner would. Tables therefore have the names and columns they had at that point, so
 * the test seeds and reads them by those names. The database is dropped afterwards.
 */
export const withSchemaBefore = async (
  testDbUrl: string,
  migration: string,
  run: (db: Client, apply: (file?: string) => Promise<void>) => Promise<void>,
) => {
  const files = await migrationFiles()
  if (!files.includes(migration)) throw new Error(`Unknown migration: ${migration}`)
  const database = await createDatabase(testDbUrl, `before_${migration.slice(0, 12)}`)
  const db = new Client({ connectionString: database.url })
  const apply = (file = migration) => applyMigration(db, file)
  try {
    await db.connect()
    for (const file of files.filter((file) => file < migration)) await apply(file)
    await run(db, apply)
  } finally {
    await db.end().catch(() => undefined)
    await database.drop()
  }
}

/**
 * A throwaway database with the current schema, for a test file that changes the schema
 * itself and must not do so in the database other test files are using. Returns its URL
 * and `drop`, to call once every connection to it is closed.
 */
export const createCurrentSchemaDatabase = async (testDbUrl: string) => {
  const database = await createDatabase(testDbUrl, "current")
  const db = new Client({ connectionString: database.url })
  try {
    await db.connect()
    for (const file of await migrationFiles()) await applyMigration(db, file)
  } catch (error) {
    await db.end().catch(() => undefined)
    await database.drop()
    throw error
  }
  await db.end()
  return database
}

const migrationFiles = async () =>
  (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()

/** Each file is one transaction, as in scripts/migrate.mjs. */
const applyMigration = async (db: Client, file: string) => {
  await db.query("BEGIN")
  try {
    await db.query(await readFile(new URL(file, migrations), "utf8"))
    await db.query("COMMIT")
  } catch (error) {
    await db.query("ROLLBACK")
    throw error
  }
}

const createDatabase = async (testDbUrl: string, purpose: string) => {
  const name = `${purpose}_${randomUUID().replaceAll("-", "").slice(0, 16)}`
  const target = new URL(testDbUrl)
  target.pathname = `/${name}`
  const admin = async (sql: string) => {
    const client = new Client({ connectionString: testDbUrl })
    await client.connect()
    try {
      await client.query(sql)
    } finally {
      await client.end()
    }
  }
  await admin(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`)
  return {
    url: target.toString(),
    drop: () => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  }
}
