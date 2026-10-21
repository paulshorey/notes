// AUTO-GENERATED FILE. DO NOT EDIT.
// Run: pnpm --filter @lib/db-items db:types:generate

export interface ItemCategoryLinkV1Row {
  item_id: number
  category_id: number
  workspace_id: number
}

export interface ItemTagLinkV1Row {
  item_id: number
  tag_id: number
  workspace_id: number
}

export interface UserApiTokenV1Row {
  id: number
  user_id: number
  token_hash: string
  time_created: Date
  time_last_used: Date | null
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

export interface WorkspaceCategoryV1Row {
  id: number
  workspace_id: number
  label: string
  category_embedding: string | null
  embedding_model: string | null
  embedding_updated_at: Date | null
  time_created: Date
  time_modified: Date
}

export interface WorkspaceItemV1Row {
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

export interface WorkspaceStatusV1Row {
  id: number
  workspace_id: number
  label: string
  position: number
  time_created: Date
  time_modified: Date
}

export interface WorkspaceTagV1Row {
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
  item_category_link_v1: ItemCategoryLinkV1Row
  item_tag_link_v1: ItemTagLinkV1Row
  user_api_token_v1: UserApiTokenV1Row
  user_v1: UserV1Row
  user_workspace_v1: UserWorkspaceV1Row
  workspace_category_v1: WorkspaceCategoryV1Row
  workspace_item_v1: WorkspaceItemV1Row
  workspace_status_v1: WorkspaceStatusV1Row
  workspace_tag_v1: WorkspaceTagV1Row
}
