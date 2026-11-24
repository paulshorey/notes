import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { itemModelDocument } from "../contracts/item-model"

/**
 * Write or check `generated/contracts/item-model.json`, the committed copy of the item
 * model that `GET /api/items/model` serves.
 */
const mode = process.argv[2]
if (mode !== "--check" && mode !== "--write")
  throw new Error("Usage: generate-item-model.ts --check|--write")

const file = path.join(process.cwd(), "generated/contracts/item-model.json")
const expected = `${JSON.stringify(itemModelDocument(), null, 2)}\n`

if (mode === "--write") {
  await fs.writeFile(file, expected)
  console.log("Wrote generated/contracts/item-model.json")
} else if ((await fs.readFile(file, "utf8").catch(() => "")) !== expected) {
  console.error(
    "generated/contracts/item-model.json is out of date. Run `pnpm --filter @lib/db-items app:contract:generate`.",
  )
  process.exit(1)
}
