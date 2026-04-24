export { getDb } from "./lib/db/postgres";

export {
  createNoteForUser,
  deleteNoteForUser,
  listNotesByUser,
  listNotesMissingEmbeddingsByUser,
  parseNoteInput,
  searchNotesByEmbedding,
  updateNoteEmbeddingsForUser,
  updateNoteForUser,
} from "./sql/note";
export { listCategoriesByUser } from "./sql/category";
export { listTagsByUser } from "./sql/tag";
export { findUserByIdentifier, getUserById, updateUserPreferencesById } from "./sql/user";

export type {
  UserNoteCategoryV1Row,
  PostgresDbSchema,
  UserNoteTagLinkV1Row,
  UserNoteTagV1Row,
  UserNoteV1Row,
  UserV1Row,
} from "./generated/typescript/db-types";
export type {
  CategoriesRequest,
  CategoriesResponse,
  CategoryRecord,
  CreateCategoryRequest,
  CreateCategoryResponse,
  TagsRequest,
  TagsResponse,
  TagRecord,
  NoteCategoryRef,
  CreateTagRequest,
  CreateTagResponse,
  CreateNoteRequest,
  DeleteCategoryRequest,
  DeleteCategoryResponse,
  DeleteTagRequest,
  DeleteTagResponse,
  EmbeddingMaintenanceRequest,
  EmbeddingMaintenanceResponse,
  DeleteNoteRequest,
  DeleteResponse,
  ErrorResponse,
  NoteTagRef,
  NoteInput,
  NoteRecord,
  NoteResponse,
  NotesRequest,
  NotesResponse,
  SearchRequest,
  SearchResponse,
  SemanticSearchResult,
  SessionLookupRequest,
  UpdateUserPreferencesRequest,
  SessionRequest,
  SessionResponse,
  UserPreferences,
  UpdateCategoryRequest,
  UpdateCategoryResponse,
  UpdateTagRequest,
  UpdateTagResponse,
  UpdateNoteRequest,
  UserSummary,
  NotesAppPreferences,
} from "./contracts/notes-app";
export type { NoteEmbeddingBackfillRow, NoteEmbeddingWriteInput } from "./sql/note";
