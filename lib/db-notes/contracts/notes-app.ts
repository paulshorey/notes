export interface TokenLoginRequest {
  identifier: string;
  password: string;
}

export interface NotesAppPreferences {
  markdownEditorMode?: string;
  resultsColumnWidth?: number;
  pasteUrlAsMarkdown?: boolean;
  /** How many notes stay open at once in the web editor. */
  maxOpenNotes?: number;
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

/**
 * Tier numbers are the only stable identity a tier has. Labels are user data
 * and must never be branched on — see `TaxonomyLevelRecord`.
 */
export const TAXONOMY_LEVEL_EPIC = 1;
export const TAXONOMY_LEVEL_CATEGORY = 2;
export const TAXONOMY_LEVEL_GROUP = 3;
/** Names the leaf content itself ("Note", or "Task"); has no hierarchy rows. */
export const TAXONOMY_LEVEL_CONTENT = 4;

export const DEFAULT_TAXONOMY_LEVEL_LABELS: Record<number, string> = {
  1: "Epic",
  2: "Category",
  3: "Group",
  4: "Note",
};

/** The word this user uses for one tier. Display text only. */
export interface TaxonomyLevelRecord {
  userId: number;
  level: number;
  label: string;
}

export interface TaxonomyRecord {
  id: number;
  userId: number;
  level: number;
  parentId: number | null;
  label: string;
  /** Notes anywhere beneath this row. */
  noteCount: number;
  /** Notes attached directly; always 0 above level 3. */
  directNoteCount: number;
  lastUsedAt: string | null;
}

export interface TagRecord {
  id: number;
  userId: number;
  label: string;
  noteCount: number;
  lastUsedAt: string | null;
}

export interface NoteTagRef {
  id: number;
  label: string;
}

export interface NoteRecord {
  id: number;
  userId: number;
  /**
   * The leaf group only. The category and epic are resolved from the taxonomy
   * tree, which every client already holds; embedding them here would cost a
   * third of the notes payload to duplicate a few kB of tree, and would give
   * labels two sources of truth that drift on rename.
   */
  groupId: number;
  tags: NoteTagRef[];
  description: string | null;
  timeDue: string | null;
  timeRemind: string | null;
  timeCreated: string;
  timeModified: string;
}

export interface SemanticSearchResult {
  note: NoteRecord;
  similarity: number;
}

export interface NoteInput {
  groupId: number;
  tagIds: number[];
  description: string;
  timeDue: string | null;
  timeRemind: string | null;
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

export interface TaxonomyRequest {
  userId: number;
}

export interface CreateTaxonomyRequest {
  userId: number;
  level: number;
  parentId: number | null;
  label: string;
}

/** Rename (`label`) or move (`parentId`); exactly one of the two. */
export interface UpdateTaxonomyRequest {
  userId: number;
  taxonomyId: number;
  label: string | null;
  parentId: number | null;
}

/**
 * `reassign-children` keeps descendants and notes by promoting them into the
 * deleted node's nearest surviving sibling; `delete-subtree` removes the whole
 * subtree and its notes. There is no default — an unspecified disposition is a
 * request to silently lose data.
 */
export type DeleteTaxonomyMode = "reassign-children" | "delete-subtree";

export interface DeleteTaxonomyRequest {
  userId: number;
  taxonomyId: number;
  mode: DeleteTaxonomyMode;
}

/** Resolve or create a whole Epic > Category > Group path in one transaction. */
export interface TaxonomyPathRequest {
  userId: number;
  epicLabel: string;
  categoryLabel: string;
  groupLabel: string;
}

export interface TaxonomySuggestRequest {
  userId: number;
  level: number;
  parentId: number | null;
  query: string;
  limit: number;
}

export interface UpdateTaxonomyLevelRequest {
  userId: number;
  level: number;
  label: string;
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
  /**
   * Delivered with the session so the UI never paints default English tier
   * names and then corrects itself a moment later.
   */
  taxonomyLevels: TaxonomyLevelRecord[];
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

export interface TaxonomyResponse {
  /** The whole tree, flat. The client builds the shape it needs. */
  taxonomy: TaxonomyRecord[];
  levels: TaxonomyLevelRecord[];
}

/**
 * Old anonymous id -> surviving destination id. The client holds taxonomy and
 * tag ids in the drafts of open notes; without these it would fall back to a
 * default group and lose a note's placement.
 */
export interface MergeIdRemapEntry {
  anonId: number;
  realId: number;
}

export interface MergeIdRemaps {
  taxonomy: MergeIdRemapEntry[];
  tags: MergeIdRemapEntry[];
}

export interface MergeSessionResponse {
  user: UserSummary;
  taxonomyLevels: TaxonomyLevelRecord[];
  remaps: MergeIdRemaps;
}

export interface TaxonomyLevelsResponse {
  levels: TaxonomyLevelRecord[];
}

export interface CreateTaxonomyResponse {
  taxonomy: TaxonomyRecord;
}

export interface UpdateTaxonomyResponse {
  taxonomy: TaxonomyRecord;
}

export interface DeleteTaxonomyResponse {
  ok: true;
  deletedNotes: number;
  deletedNodes: number;
}

export interface TaxonomyPathResponse {
  epic: TaxonomyRecord;
  category: TaxonomyRecord;
  group: TaxonomyRecord;
}

export interface TaxonomySuggestResponse {
  suggestions: TaxonomyRecord[];
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
  taxonomyUpdated: number;
  tagsUpdated: number;
  hasMore: boolean;
}

export interface DeleteResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
