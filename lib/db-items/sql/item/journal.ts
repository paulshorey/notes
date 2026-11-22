import type { PoolClient } from "pg"
import { JournalDayTakenError } from "../../contracts/item-journal"
import { getDb } from "../../lib/db/postgres"
import { selectItemById } from "./shared"

/**
 * True when the source entry adds no text to the destination: it has none, or the
 * destination already holds it, as when the same backup is restored a second time.
 */
const NOTHING_TO_APPEND = `(NULLIF(btrim(s.description),'') IS NULL
  OR position(btrim(s.description) in COALESCE(d.description,''))>0)`

/**
 * Combine journal entries, given `pairs(source_id,dest_id)`: each destination entry
 * takes the source's text after its own and the source's tags, matched by label in the
 * destination's workspace, and the source entry is deleted. The destination keeps its
 * filing and everything else it holds. Text the destination already holds is not added
 * again. When its text changes, its embedding is cleared; embedding maintenance writes
 * the new one. Returns the destination ids.
 *
 * Combining is permanent: the source does not go to the trash, because its text now
 * lives in the destination.
 */
const combineSql = (pairs: string) => `WITH pairs AS MATERIALIZED (${pairs}),
  appended AS (
    UPDATE public.workspace_item_v1 d
    SET description=CASE WHEN ${NOTHING_TO_APPEND} THEN d.description
        ELSE concat_ws(E'\\n\\n',NULLIF(btrim(d.description),''),NULLIF(btrim(s.description),'')) END,
      description_embedding=CASE WHEN ${NOTHING_TO_APPEND} THEN d.description_embedding END,
      embedding_model=CASE WHEN ${NOTHING_TO_APPEND} THEN d.embedding_model END,
      embedding_updated_at=CASE WHEN ${NOTHING_TO_APPEND} THEN d.embedding_updated_at END
    FROM pairs p JOIN public.workspace_item_v1 s ON s.id=p.source_id
    WHERE d.id=p.dest_id
  ), tagged AS (
    INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id)
    SELECT p.dest_id,dt.id,d.workspace_id FROM pairs p
    JOIN public.workspace_item_v1 d ON d.id=p.dest_id
    JOIN public.item_tag_link_v1 l ON l.item_id=p.source_id
    JOIN public.workspace_tag_v1 st ON st.id=l.tag_id
    JOIN public.workspace_tag_v1 dt ON dt.workspace_id=d.workspace_id AND dt.label=st.label
    ON CONFLICT DO NOTHING
  ), removed AS (
    DELETE FROM public.workspace_item_v1 s USING pairs p WHERE s.id=p.source_id
  )
  SELECT dest_id FROM pairs ORDER BY dest_id`

/**
 * Before items move from workspace `$2` to `$1`: combine each moving journal entry
 * whose day the destination already has into that entry. `$3` narrows the move to some
 * ids (null for all) and `$4` leaves ids out. The tags the entries carry must already
 * exist in the destination.
 */
export const COMBINE_MOVING_JOURNAL_DAYS_SQL = combineSql(
  `SELECT s.id source_id,d.id dest_id FROM public.workspace_item_v1 s
   JOIN public.workspace_item_v1 d ON d.workspace_id=$1 AND d.entry_date=s.entry_date
   WHERE s.workspace_id=$2 AND s.entry_date IS NOT NULL
     AND ($3::int[] IS NULL OR s.id=ANY($3)) AND s.id<>ALL($4::int[])`,
)

const COMBINE_ENTRY_INTO_DAY_SQL = combineSql(
  `SELECT s.id source_id,d.id dest_id FROM public.workspace_item_v1 s
   JOIN public.workspace_item_v1 d ON d.workspace_id=s.workspace_id AND d.entry_date=$2::date
   WHERE s.id=$1 AND d.id<>s.id`,
)

/**
 * Move the user's item to a journal day that another entry of its workspace already
 * has, by combining it into that entry. Returns the entry that now holds both, or null
 * when the item is not the user's or the day has no entry to combine with.
 */
export const combineItemIntoJournalDay = async (userId: number, itemId: number, day: string) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const owned = await client.query(
      `SELECT 1 FROM public.workspace_item_v1 n JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
       WHERE n.id=$1 AND w.user_id=$2 FOR UPDATE OF n`,
      [itemId, userId],
    )
    if (owned.rowCount !== 1) {
      await client.query("ROLLBACK")
      return null
    }
    const combined = await client.query<{ dest_id: number }>(COMBINE_ENTRY_INTO_DAY_SQL, [
      itemId,
      day,
    ])
    const destinationId = combined.rows[0]?.dest_id
    const item =
      destinationId === undefined ? null : await selectItemById(client, destinationId, userId)
    await client.query(item ? "COMMIT" : "ROLLBACK")
    return item
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/**
 * Add a trashed journal entry's text and tags to the entry its day now has in
 * workspace `$1`. `$2` is the day, `$3` the text, and `$4` the tag labels; a tag the
 * workspace does not have is left off. Returns the entry's id, or nothing when the day
 * has no entry.
 */
export const combineTrashedEntryIntoDay = async (
  client: PoolClient,
  workspaceId: number,
  day: string,
  text: string | null,
  tagLabels: string[],
) => {
  const { rows } = await client.query<{ id: number }>(
    `WITH target AS (
       UPDATE public.workspace_item_v1 d
       SET description=concat_ws(E'\\n\\n',NULLIF(btrim(d.description),''),NULLIF(btrim($3::text),'')),
         description_embedding=CASE WHEN NULLIF(btrim($3::text),'') IS NULL THEN d.description_embedding END,
         embedding_model=CASE WHEN NULLIF(btrim($3::text),'') IS NULL THEN d.embedding_model END,
         embedding_updated_at=CASE WHEN NULLIF(btrim($3::text),'') IS NULL THEN d.embedding_updated_at END
       WHERE d.workspace_id=$1 AND d.entry_date=$2::date RETURNING d.id
     ), tagged AS (
       INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id)
       SELECT target.id,t.id,$1 FROM target
       JOIN public.workspace_tag_v1 t ON t.workspace_id=$1 AND t.label=ANY($4::text[])
       ON CONFLICT DO NOTHING
     )
     SELECT id FROM target`,
    [workspaceId, day, text, tagLabels],
  )
  if (rows[0] === undefined) throw new JournalDayTakenError()
  return rows[0].id
}
