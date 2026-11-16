import { createHash } from "node:crypto"
import type { PoolClient } from "pg"
import { ITEM_IDENTITY_FIELDS, PORTABLE_ITEMS_SQL } from "../item/stored-capabilities"

/** Content plus creation time identifies an exact copy without trusting exported ids.
 * The fields come from the capability registry, so new content joins the comparison by
 * being declared there. Counts, rather than a Set, preserve identical twins.
 */
export const itemMergeIdentities = async (client: PoolClient, workspaceId: number) => {
  const { rows } = await client.query<{ id: number } & Record<string, unknown>>(
    PORTABLE_ITEMS_SQL,
    [workspaceId],
  )
  return new Map(
    rows.map((row) => [
      row.id,
      createHash("sha256")
        .update(JSON.stringify(ITEM_IDENTITY_FIELDS.map((field) => [field, row[field]])))
        .digest("hex"),
    ]),
  )
}
