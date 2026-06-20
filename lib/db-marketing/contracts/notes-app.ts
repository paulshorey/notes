export interface TokenLoginRequest {
  identifier: string;
  password: string;
}

export interface NotesAppPreferences {
  markdownEditorMode?: string;
  resultsColumnWidth?: number;
}

export interface UserPreferences {
  notesApp?: NotesAppPreferences;
}

export interface UserSummary {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  preferences: UserPreferences;
}

export interface CategoryRecord {
  id: number;
  userId: number;
  label: string;
  noteCount: number;
  lastUsedAt: string | null;
}

export interface TagRecord {
  id: number;
  userId: number;
  label: string;
  noteCount: number;
  lastUsedAt: string | null;
}

export interface NoteCategoryRef {
  id: number;
  label: string;
}

export interface NoteTagRef {
  id: number;
  label: string;
}

export interface WorkflowStatusRef {
  id: number;
  label: string;
  sortOrder: number;
  isTerminal: boolean;
}

export interface WorkflowStatusRecord extends WorkflowStatusRef {
  userId: number;
  itemCount: number;
  lastUsedAt: string | null;
}

export interface NoteRecord {
  id: number;
  userId: number;
  category: NoteCategoryRef;
  workflowStatus: WorkflowStatusRef | null;
  tags: NoteTagRef[];
  description: string | null;
  timeDue: string | null;
  timeRemind: string | null;
  timeCompleted: string | null;
  timeCreated: string;
  timeModified: string;
}

export interface SemanticSearchResult {
  note: NoteRecord;
  similarity: number;
  tagSimilarity: number | null;
  descriptionSimilarity: number | null;
}

export interface NoteInput {
  categoryId: number;
  tagIds: number[];
  description: string;
  timeDue: string | null;
  timeRemind: string | null;
  workflowStatusId: number | null;
}

export interface SessionRequest {
  userId: number;
}

export interface UpdateUserPreferencesRequest {
  userId: number;
  preferences: UserPreferences;
}

export interface NotesRequest {
  userId: number;
}

export interface TagsRequest {
  userId: number;
}

export interface CategoriesRequest {
  userId: number;
}

export interface WorkflowStatusesRequest {
  userId: number;
}

export interface CreateCategoryRequest {
  userId: number;
  label: string;
}

export interface UpdateCategoryRequest {
  userId: number;
  categoryId: number;
  label: string;
}

export interface DeleteCategoryRequest {
  userId: number;
  categoryId: number;
}

export interface CreateWorkflowStatusRequest {
  userId: number;
  label: string;
}

export interface UpdateWorkflowStatusRequest {
  userId: number;
  workflowStatusId: number;
  label?: string;
  sortOrder?: number;
}

export interface DeleteWorkflowStatusRequest {
  userId: number;
  workflowStatusId: number;
  reassignToId: number;
}

export interface CreateTagRequest {
  userId: number;
  label: string;
}

export interface UpdateTagRequest {
  userId: number;
  tagId: number;
  label: string;
}

export interface DeleteTagRequest {
  userId: number;
  tagId: number;
}

export interface CreateNoteRequest {
  userId: number;
  note: NoteInput;
}

export interface UpdateNoteRequest {
  userId: number;
  noteId: number;
  note: NoteInput;
}

export interface DeleteNoteRequest {
  userId: number;
  noteId: number;
}

export interface SearchRequest {
  userId: number;
  query: string;
  limit: number;
}

export interface EmbeddingMaintenanceRequest {
  userId: number;
  mode: string;
  limit: number;
}

export interface SessionResponse {
  user: UserSummary;
}

export interface TokenLoginResponse {
  token: string;
  user: UserSummary;
}

export interface TokenRevokeResponse {
  ok: true;
}

export interface NotesResponse {
  notes: NoteRecord[];
}

export interface TagsResponse {
  tags: TagRecord[];
}

export interface CategoriesResponse {
  categories: CategoryRecord[];
}

export interface WorkflowStatusesResponse {
  workflowStatuses: WorkflowStatusRecord[];
}

export interface CreateCategoryResponse {
  category: CategoryRecord;
}

export interface UpdateCategoryResponse {
  category: CategoryRecord;
}

export interface DeleteCategoryResponse {
  ok: true;
}

export interface CreateWorkflowStatusResponse {
  workflowStatus: WorkflowStatusRecord;
}

export interface UpdateWorkflowStatusResponse {
  workflowStatus: WorkflowStatusRecord;
}

export interface DeleteWorkflowStatusResponse {
  ok: true;
  reassignedItems: number;
}

export interface DeleteCategoryWithNotesRequest {
  userId: number;
  categoryId: number;
}

export interface DeleteCategoryWithNotesResponse {
  ok: true;
  deletedNotes: number;
}

export interface CreateTagResponse {
  tag: TagRecord;
}

export interface UpdateTagResponse {
  tag: TagRecord;
}

export interface DeleteTagResponse {
  ok: true;
  deletedLinks: number;
}

export interface NoteResponse {
  note: NoteRecord;
}

export interface SearchResponse {
  results: SemanticSearchResult[];
}

export interface EmbeddingMaintenanceResponse {
  mode: string;
  processed: number;
  updated: number;
  categoriesUpdated: number;
  tagsUpdated: number;
  hasMore: boolean;
}

export interface DeleteResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
