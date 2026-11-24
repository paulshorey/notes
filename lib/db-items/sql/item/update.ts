import { getDb } from "../../lib/db/postgres"
import { assertItemHasContent } from "../../contracts/item-capabilities"
import { ItemGroupConflictError } from "../item-group-errors"
import {
  ensureStatusIdForWorkspace,
  replaceItemTagsForItem,
  resolveItemFiling,
  rethrowFilingRace,
  selectItemById,
  toNullableText,
} from "./shared"
import type { ItemEmbeddingWriteInput, ItemPatch, ItemRecord } from "./types"

export const ITEM_CHANGED_ERROR = "The saved item changed since this edit began."
export const ITEM_IN_OTHER_WORKSPACE_ERROR =
  "This item is in a different workspace. Open it there to edit it."

/** An update named a modification time the stored item no longer has. */
export class ItemChangedError extends Error {
  constructor(readonly item: ItemRecord) {
    super(ITEM_CHANGED_ERROR)
    this.name = "ItemChangedError"
  }
}

interface StoredRow {
  workspace_id: number
  status_id: number | null
  description: string | null
  time_due: Date | null
  time_remind: Date | null
  category_id: number | null
  subcategory_id: number | null
  time_start: Date | null
  time_end: Date | null
  entry_date: string | null
  time_modified: Date
}

/** The patch's value for a field when it names one, otherwise the stored value. */
const given = <Value>(value: Value | undefined, stored: Value): Value =>
  value === undefined ? stored : value

/**
 * Apply a patch to the user's item: the fields it names are written and the rest stay
 * as stored. The item is locked first, so the version check, the save rules, and the
 * write all see the same stored item.
 *
 * Returns the updated item, or null when the user has no such item. Throws
 * `ItemChangedError` when `expectedTimeModified` names an older version, and the save
 * rules' errors when the result would hold no content or a state without what it
 * requires. Changed text clears the embedding, which is written again afterwards.
 */
export const updateItemForUser = async (
  itemId: number,
  userId: number,
  patch: ItemPatch,
  { expectedTimeModified = null }: { expectedTimeModified?: string | null } = {},
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<StoredRow>(
      `SELECT n.workspace_id,n.status_id,n.description,n.time_due,n.time_remind,n.category_id,
        n.subcategory_id,n.time_start,n.time_end,n.entry_date::text AS entry_date,n.time_modified
       FROM public.workspace_item_v1 n JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
       WHERE n.id=$1 AND w.user_id=$2 FOR UPDATE OF n`,
      [itemId, userId],
    )
    const stored = rows[0]
    if (!stored) {
      await client.query("ROLLBACK")
      return null
    }
    if (patch.workspaceId !== undefined && patch.workspaceId !== stored.workspace_id)
      throw new ItemGroupConflictError(ITEM_IN_OTHER_WORKSPACE_ERROR)
    // A caller's time has milliseconds, and so does the driver's reading of the stored one.
    if (
      expectedTimeModified !== null &&
      stored.time_modified.toISOString() !== expectedTimeModified
    ) {
      const current = await selectItemById(client, itemId, userId)
      await client.query("ROLLBACK")
      if (!current) return null
      throw new ItemChangedError(current)
    }

    const workspaceId = stored.workspace_id
    const description = given(
      patch.description === undefined ? undefined : toNullableText(patch.description),
      stored.description,
    )
    const next = {
      description,
      statusId: given(patch.statusId, stored.status_id),
      timeStart: given(patch.timeStart, stored.time_start?.toISOString() ?? null),
      timeEnd: given(patch.timeEnd, stored.time_end?.toISOString() ?? null),
      entryDate: given(patch.entryDate, stored.entry_date),
      timeDue: given(patch.timeDue, stored.time_due?.toISOString() ?? null),
      timeRemind: given(patch.timeRemind, stored.time_remind?.toISOString() ?? null),
    }
    assertItemHasContent(next)
    if (patch.statusId != null) await ensureStatusIdForWorkspace(client, workspaceId, next.statusId)
    // A category named alone keeps the stored subcategory only while it still fits.
    const filing =
      patch.categoryId === undefined && patch.subcategoryId === undefined
        ? { categoryId: stored.category_id, subcategoryId: stored.subcategory_id }
        : await resolveItemFiling(
            client,
            workspaceId,
            given(patch.categoryId, stored.category_id),
            given(patch.subcategoryId, stored.subcategory_id),
          )
    const textChanged = next.description !== stored.description
    // Only the columns the patch names are written, so a stored value the patch says
    // nothing about is never read into JavaScript and written back.
    const values: unknown[] = [itemId]
    const sets: string[] = []
    const set = (column: string, value: unknown, cast = "") => {
      values.push(value)
      sets.push(`${column}=$${values.length}${cast}`)
    }
    if (patch.statusId !== undefined) set("status_id", next.statusId)
    if (patch.description !== undefined) set("description", next.description)
    if (patch.timeDue !== undefined) set("time_due", next.timeDue)
    if (patch.timeRemind !== undefined) set("time_remind", next.timeRemind)
    if (patch.timeStart !== undefined || patch.timeEnd !== undefined) {
      set("time_start", next.timeStart)
      set("time_end", next.timeEnd)
    }
    if (patch.entryDate !== undefined) set("entry_date", next.entryDate, "::date")
    if (patch.categoryId !== undefined || patch.subcategoryId !== undefined) {
      set("category_id", filing.categoryId)
      set("subcategory_id", filing.subcategoryId)
    }
    if (textChanged)
      sets.push("description_embedding=NULL", "embedding_model=NULL", "embedding_updated_at=NULL")
    // The row is written even when only its tags change, so `time_modified` moves with
    // every change to the item.
    if (sets.length === 0) sets.push("workspace_id=workspace_id")
    await client.query(`UPDATE public.workspace_item_v1 SET ${sets.join(",")} WHERE id=$1`, values)
    if (patch.tagIds !== undefined)
      await replaceItemTagsForItem(client, itemId, workspaceId, patch.tagIds)
    const updated = await selectItemById(client, itemId, userId)
    if (!updated) throw new Error("Failed to load updated item.")
    await client.query("COMMIT")
    return updated
  } catch (error) {
    await client.query("ROLLBACK")
    return rethrowFilingRace(error)
  } finally {
    client.release()
  }
}

/**
 * Store the embedding of an item's text. It is written only while the item still holds
 * the text that was embedded, and it leaves `time_modified` alone: an embedding is
 * derived from the item and is not a change to it. Returns whether it was stored.
 */
export const updateItemEmbeddingsForUser = async (
  itemId: number,
  userId: number,
  embeddings: ItemEmbeddingWriteInput,
  embeddedText: string | null,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    await client.query(`SELECT set_config('app.keep_time_modified','on',true)`)
    const result = await client.query(
      `UPDATE public.workspace_item_v1 n SET description_embedding=$3::vector,embedding_model=$4,embedding_updated_at=$5
       FROM public.user_workspace_v1 w WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2
         AND n.description IS NOT DISTINCT FROM $6::text`,
      [
        itemId,
        userId,
        embeddings.descriptionEmbedding,
        embeddings.embeddingModel,
        embeddings.embeddingModel ? new Date().toISOString() : null,
        embeddedText,
      ],
    )
    await client.query("COMMIT")
    return result.rowCount === 1
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
