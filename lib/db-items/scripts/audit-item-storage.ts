import process from "node:process"
import { Client } from "pg"
import { findUndeclaredItemStorage } from "../sql/item/storage-audit"

const connectionString = process.env.DB_ITEMS_URL ?? process.env.DB_NOTES_URL
if (!connectionString) throw new Error("DB_ITEMS_URL is required (DB_NOTES_URL remains supported)")

const client = new Client({ connectionString })
await client.connect()
try {
  const { columns, tables } = await findUndeclaredItemStorage(client)
  if (columns.length || tables.length) {
    console.error(
      [
        "Item storage is not declared in sql/item/stored-capabilities.ts:",
        ...columns.map((name) => `  column workspace_item_v1.${name}`),
        ...tables.map((name) => `  table ${name}`),
        "Declare each under the capability that owns it, or as taxonomy or derived data,",
        "so backup, restore, duplicate detection, and account merge account for it.",
      ].join("\n"),
    )
    process.exitCode = 1
  }
} finally {
  await client.end()
}
