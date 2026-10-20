/** Replay immutable historical migration logic against the current table names. */
export const adaptHistoricalMigration = (sql: string) =>
  sql
    .replaceAll("workspace_note_category_v1", "workspace_category_v1")
    .replaceAll("workspace_note_status_v1", "workspace_status_v1")
    .replaceAll("workspace_note_tag_v1", "workspace_tag_v1")
    .replaceAll("user_note_category_link_v1", "item_category_link_v1")
    .replaceAll("user_note_tag_link_v1", "item_tag_link_v1")
    .replaceAll("user_note_v1", "workspace_item_v1")
    .replaceAll("note_id", "item_id")
