export interface TokenLoginRequest {
  identifier: string
  password: string
}

export interface TextClientPreferences {
  markdownEditorMode?: string
  resultsColumnWidth?: number
  pasteUrlAsMarkdown?: boolean
  /** How many notes stay open at once in the web editor. */
  maxOpenNotes?: number
  /** Last workspace used by the web app. The server always re-authorizes it. */
  currentWorkspaceId?: number
  /** Kinds the user chose to leave out of the notes view, which otherwise lists them. */
  notesViewHiddenKinds?: string[]
}

export interface UserPreferences {
  notesApp?: TextClientPreferences
}

export interface UserSummary {
  id: number
  username: string
  email: string | null
  phone: string | null
  preferences: UserPreferences
}

/** `itemCount` and `lastUsedAt` cover every item filed in the category, in a subcategory or not. */
export interface CategoryRecord {
  id: number
  workspaceId: number
  label: string
  itemCount: number
  lastUsedAt: string | null
  subcategories: SubcategoryRecord[]
}

export interface SubcategoryRecord {
  id: number
  categoryId: number
  label: string
  itemCount: number
  lastUsedAt: string | null
}

export interface TagRecord {
  id: number
  workspaceId: number
  label: string
  itemCount: number
  lastUsedAt: string | null
}

export interface WorkspaceRecord {
  id: number
  /** Permanent public identity; see contracts/public-uid.ts. */
  uid: string
  userId: number
  label: string
  itemCount: number
}

export interface StatusRecord {
  id: number
  workspaceId: number
  label: string
  position: number
  itemCount: number
  lastUsedAt: string | null
}

export interface CategoryRef {
  id: number
  label: string
}

export interface TagRef {
  id: number
  label: string
}

/** An item is filed in at most one category and one subcategory of that category. */
export interface ItemRecord {
  id: number
  /** Permanent public identity; see contracts/public-uid.ts. */
  uid: string
  workspaceId: number
  category: CategoryRef | null
  subcategory: CategoryRef | null
  status: CategoryRef | null
  tags: TagRef[]
  description: string | null
  /** A time block's start and end. Both are set, or both are null. */
  timeStart: string | null
  timeEnd: string | null
  /** Whether the time block is a plan not yet confirmed. False without a time block. */
  timePlanned: boolean
  timeDue: string | null
  timeRemind: string | null
  timeCreated: string
  timeModified: string
}

/**
 * A deleted item waiting in the trash. It is no longer an item: it has no item id or
 * uid to act on, only the trash entry's own `id`, and its workspace and vocabulary are
 * kept by label.
 */
export interface TrashedItemRecord {
  id: number
  workspaceLabel: string
  timeDeleted: string
  description: string | null
  category: string | null
  subcategory: string | null
  status: string | null
  tags: string[]
  timeStart: string | null
  timeEnd: string | null
  timePlanned: boolean
  timeDue: string | null
  timeRemind: string | null
}

export interface SemanticSearchResult {
  item: ItemRecord
  similarity: number
}

export interface ItemInput {
  /**
   * On create, the uid the new item takes. A create repeated with the same uid returns
   * the item the first one stored. Ignored on update.
   */
  uid?: string | null
  workspaceId: number
  categoryId: number | null
  subcategoryId: number | null
  statusId: number | null
  tagIds: number[]
  description: string | null
  /**
   * The time block. Given only one of the two, the other takes the same instant. A
   * request that names neither field leaves a stored item's time block as it is, so a
   * client that does not know about time blocks cannot remove one.
   */
  timeStart?: string | null
  timeEnd?: string | null
  /** Left out, a new block is a plan when it starts in the future. */
  timePlanned?: boolean | null
  timeDue: string | null
  timeRemind: string | null
}

export interface SessionRequest {
  userId: number
}

export interface UpdateUserPreferencesRequest {
  userId: number
  preferences: UserPreferences
}

export interface ItemsRequest {
  userId: number
  workspaceId: number
}

export interface TagsRequest {
  userId: number
  workspaceId: number
}

export interface CategoriesRequest {
  userId: number
  workspaceId: number
}

export interface StatusesRequest {
  userId: number
  workspaceId: number
}
export interface WorkspacesRequest {
  userId: number
}

/** With `categoryId`, creates a subcategory of that category instead of a category. */
export interface CreateCategoryRequest {
  userId: number
  workspaceId: number
  label: string
  categoryId?: number
}

export interface UpdateCategoryRequest {
  userId: number
  workspaceId: number
  categoryId: number
  label: string
}

export interface DeleteCategoryRequest {
  userId: number
  workspaceId: number
  categoryId: number
}

export interface CreateTagRequest {
  userId: number
  workspaceId: number
  label: string
}

export interface UpdateTagRequest {
  userId: number
  workspaceId: number
  tagId: number
  label: string
}

export interface DeleteTagRequest {
  userId: number
  workspaceId: number
  tagId: number
}

export interface CreateItemRequest {
  userId: number
  item: ItemInput
}

export interface UpdateItemRequest {
  userId: number
  itemId: number
  item: ItemInput
  /**
   * The `timeModified` of the item as the caller last saw it. When the stored item has
   * changed since, the update is refused with `409` and an `ItemConflictResponse`.
   * Without it the update is applied whatever the stored item holds.
   */
  expectedTimeModified?: string
}

/** The body of a `409` for an update that named a stale `expectedTimeModified`. */
export interface ItemConflictResponse {
  error: string
  /** The item as it is stored now. */
  item: ItemRecord
}

export interface DeleteItemRequest {
  userId: number
  itemId: number
  workspaceId?: number
}

export interface TrashRequest {
  userId: number
}

export interface RestoreTrashedItemRequest {
  userId: number
  trashId: number
}

/** Without a `trashId`, the user's whole trash is emptied. */
export interface PurgeTrashRequest {
  userId: number
  trashId?: number
}

export interface SearchRequest {
  userId: number
  workspaceId: number
  query: string
  limit: number
}

export interface EmbeddingMaintenanceRequest {
  userId: number
  mode: string
  limit: number
}

export interface SessionResponse {
  user: UserSummary
}

export interface TokenLoginResponse {
  token: string
  user: UserSummary
}

export interface TokenRevokeResponse {
  ok: true
}

export interface ItemsResponse {
  items: ItemRecord[]
}

export interface WorkspacesResponse {
  workspaces: WorkspaceRecord[]
}
export interface WorkspaceResponse {
  workspace: WorkspaceRecord
}
export interface StatusesResponse {
  statuses: StatusRecord[]
}
export interface StatusResponse {
  status: StatusRecord
}

export interface CreateWorkspaceRequest {
  userId: number
  label: string
}
export interface UpdateWorkspaceRequest {
  userId: number
  workspaceId: number
  label: string
}
export interface DeleteWorkspaceRequest {
  userId: number
  workspaceId: number
  confirmation: string
}
export interface CreateStatusRequest {
  userId: number
  workspaceId: number
  label: string
}
export interface UpdateStatusRequest {
  userId: number
  workspaceId: number
  statusId: number
  label: string
  position?: number
}
export interface DeleteStatusRequest {
  userId: number
  workspaceId: number
  statusId: number
}

export interface BootstrapResponse {
  user: UserSummary
  workspaces: WorkspaceRecord[]
  activeWorkspaceId: number
  items: ItemRecord[]
  categories: CategoryRecord[]
  statuses: StatusRecord[]
  tags: TagRecord[]
}

export interface TagsResponse {
  tags: TagRecord[]
}

export interface CategoriesResponse {
  categories: CategoryRecord[]
}

/** `category` is the category itself or, for a subcategory, its refreshed parent. */
export interface CreateCategoryResponse {
  category: CategoryRecord
  subcategory?: SubcategoryRecord
}

export interface UpdateCategoryResponse {
  category: CategoryRecord
}

export interface DeleteCategoryResponse {
  ok: true
}

export interface CreateTagResponse {
  tag: TagRecord
}

export interface UpdateTagResponse {
  tag: TagRecord
}

export interface DeleteTagResponse {
  ok: true
  deletedLinks: number
}

export interface ItemResponse {
  item: ItemRecord
}

export interface CreateItemResponse {
  item: ItemRecord
  /**
   * False when the create named the uid of an item that already existed, so nothing
   * was written and `item` is that item as stored. The route answers 200 then, and 201
   * for a new item.
   */
  created?: boolean
}

export interface SearchResponse {
  results: SemanticSearchResult[]
}

export interface EmbeddingMaintenanceResponse {
  mode: string
  processed: number
  updated: number
  categoriesUpdated: number
  tagsUpdated: number
  hasMore: boolean
}

export interface DeleteResponse {
  ok: true
}

export interface TrashResponse {
  items: TrashedItemRecord[]
  /** Days a deleted item stays in the trash before it is removed for good. */
  retentionDays: number
}

export interface PurgeTrashResponse {
  ok: true
  purged: number
}

export interface ErrorResponse {
  error: string
}

/** Portable user data; credentials and generated search vectors are excluded. */
export interface UserBackup {
  format: string
  version: number
  exportedAt: string
  preferences: UserPreferences
  activeWorkspaceLabel: string | null
  workspaces: BackupWorkspace[]
}

export interface BackupVocabulary {
  label: string
  timeCreated: string
  timeModified: string
}

export interface BackupStatus {
  label: string
  position: number
  timeCreated: string
  timeModified: string
}

export interface BackupCategory {
  label: string
  timeCreated: string
  timeModified: string
  subcategories: BackupVocabulary[]
}

export interface BackupWorkspace {
  /** Absent in files written before workspaces had a uid. */
  uid?: string | null
  label: string
  timeCreated: string
  timeModified: string
  categories: BackupCategory[]
  statuses: BackupStatus[]
  tags: BackupVocabulary[]
  items: BackupItem[]
}

export interface BackupItem {
  /** Absent in files written before items had a uid. */
  uid?: string | null
  description: string | null
  category: string | null
  subcategory: string | null
  status: string | null
  tags: string[]
  /** Absent in files written before items had time blocks. */
  timeStart?: string | null
  timeEnd?: string | null
  timePlanned?: boolean
  timeDue: string | null
  timeRemind: string | null
  timeCreated: string
  timeModified: string
}

export interface RestoreBackupRequest {
  userId: number
  backup: UserBackup
}

export interface RestoreBackupResponse {
  itemsImported: number
  itemsSkipped: number
}
