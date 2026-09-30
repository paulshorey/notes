export interface TokenLoginRequest {
  identifier: string
  password: string
}

export interface NotesAppPreferences {
  markdownEditorMode?: string
  resultsColumnWidth?: number
  pasteUrlAsMarkdown?: boolean
  /** How many notes stay open at once in the web editor. */
  maxOpenNotes?: number
  /** Last workspace used by the web app. The server always re-authorizes it. */
  currentWorkspaceId?: number
}

export interface UserPreferences {
  notesApp?: NotesAppPreferences
}

export interface UserSummary {
  id: number
  username: string
  email: string | null
  phone: string | null
  preferences: UserPreferences
}

export interface CategoryRecord {
  id: number
  workspaceId: number
  label: string
  noteCount: number
  lastUsedAt: string | null
}

export interface TagRecord {
  id: number
  workspaceId: number
  label: string
  noteCount: number
  lastUsedAt: string | null
}

export interface WorkspaceRecord {
  id: number
  userId: number
  label: string
  noteCount: number
}

export interface StatusRecord {
  id: number
  workspaceId: number
  label: string
  position: number
  noteCount: number
  lastUsedAt: string | null
}

export interface NoteCategoryRef {
  id: number
  label: string
}

export interface NoteTagRef {
  id: number
  label: string
}

export interface NoteRecord {
  id: number
  workspaceId: number
  categories: NoteCategoryRef[]
  status: NoteCategoryRef | null
  tags: NoteTagRef[]
  description: string | null
  timeDue: string | null
  timeRemind: string | null
  timeCreated: string
  timeModified: string
}

export interface SemanticSearchResult {
  note: NoteRecord
  similarity: number
}

export interface NoteInput {
  workspaceId: number
  categoryIds: number[]
  statusId: number | null
  tagIds: number[]
  description: string
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

export interface NotesRequest {
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

export interface CreateCategoryRequest {
  userId: number
  workspaceId: number
  label: string
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

export interface CreateNoteRequest {
  userId: number
  note: NoteInput
}

export interface UpdateNoteRequest {
  userId: number
  noteId: number
  note: NoteInput
}

export interface DeleteNoteRequest {
  userId: number
  noteId: number
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

export interface NotesResponse {
  notes: NoteRecord[]
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
  notes: NoteRecord[]
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

export interface CreateCategoryResponse {
  category: CategoryRecord
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

export interface NoteResponse {
  note: NoteRecord
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

export interface ErrorResponse {
  error: string
}
