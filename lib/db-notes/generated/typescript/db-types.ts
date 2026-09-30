// AUTO-GENERATED FILE. DO NOT EDIT.
// Run: pnpm --filter @lib/db-notes db:types:generate

export interface UserApiTokenV1Row {
  id: number
  user_id: number
  token_hash: string
  time_created: Date
  time_last_used: Date | null
}

export interface UserNoteCategoryLinkV1Row {
  note_id: number
  category_id: number
  workspace_id: number
}

export interface UserNoteTagLinkV1Row {
  note_id: number
  tag_id: number
  workspace_id: number
}

export interface UserNoteV1Row {
  id: number
  workspace_id: number
  status_id: number | null
  description: string | null
  time_due: Date | null
  time_remind: Date | null
  description_embedding: string | null
  embedding_model: string | null
  embedding_updated_at: Date | null
  time_created: Date
  time_modified: Date
}

export interface UserV1Row {
  id: number
  username: string
  email: string | null
  phone: string | null
  time_created: Date
  time_modified: Date
  preferences: unknown
  password: string | null
  is_anonymous: boolean
}

export interface UserWorkspaceV1Row {
  id: number
  user_id: number
  label: string
  time_created: Date
  time_modified: Date
}

export interface WorkspaceNoteCategoryV1Row {
  id: number
  workspace_id: number
  label: string
  category_embedding: string | null
  embedding_model: string | null
  embedding_updated_at: Date | null
  time_created: Date
  time_modified: Date
}

export interface WorkspaceNoteStatusV1Row {
  id: number
  workspace_id: number
  label: string
  position: number
  time_created: Date
  time_modified: Date
}

export interface WorkspaceNoteTagV1Row {
  id: number
  workspace_id: number
  label: string
  tag_embedding: string | null
  embedding_model: string | null
  embedding_updated_at: Date | null
  time_created: Date
  time_modified: Date
}

export interface PostgresDbSchema {
  user_api_token_v1: UserApiTokenV1Row
  user_note_category_link_v1: UserNoteCategoryLinkV1Row
  user_note_tag_link_v1: UserNoteTagLinkV1Row
  user_note_v1: UserNoteV1Row
  user_v1: UserV1Row
  user_workspace_v1: UserWorkspaceV1Row
  workspace_note_category_v1: WorkspaceNoteCategoryV1Row
  workspace_note_status_v1: WorkspaceNoteStatusV1Row
  workspace_note_tag_v1: WorkspaceNoteTagV1Row
}
