import type {
  CategoriesRequest,
  CategoriesResponse,
  CreateCategoryRequest,
  CreateCategoryResponse,
  CreateNoteRequest,
  CreateTagRequest,
  CreateTagResponse,
  DeleteCategoryRequest,
  DeleteCategoryResponse,
  DeleteNoteRequest,
  DeleteResponse,
  DeleteTagRequest,
  DeleteTagResponse,
  EmbeddingMaintenanceRequest,
  EmbeddingMaintenanceResponse,
  NotesRequest,
  NotesResponse,
  NoteResponse,
  SearchRequest,
  SearchResponse,
  SessionLookupRequest,
  SessionRequest,
  SessionResponse,
  TagsRequest,
  TagsResponse,
  UpdateUserPreferencesRequest,
  UpdateCategoryRequest,
  UpdateCategoryResponse,
  UpdateNoteRequest,
  UpdateTagRequest,
  UpdateTagResponse,
  UserPreferences,
} from "../contracts/notes-app";
import type { PoolClient } from "pg";
import { getDb } from "../lib/db/postgres";
import { NOTES_APP_SEARCH_MAX_RESULTS } from "../notes-search-constants";
import {
  createNoteForUser,
  deleteNoteForUser,
  listNotesByUser,
  listNotesMissingEmbeddingsByUser,
  listNotesStaleEmbeddingsByUser,
  parseNoteInput,
  searchNotesByEmbedding,
  updateNoteEmbeddingsForUser,
  updateNoteForUser,
} from "../sql/note";
import {
  resolveCategoryIdForUser,
  resolveTagIdForUser,
} from "../sql/note/shared";
import {
  deleteCategoryForUser,
  getCategoryByIdForUser,
  getFirstCategoryForUser,
  listCategoriesByUser,
  listCategoriesMissingEmbeddingsByUser,
  listCategoriesStaleEmbeddingsByUser,
  updateCategoryEmbeddingById,
  updateCategoryLabelForUser,
} from "../sql/category";
import {
  deleteTagForUser,
  getTagByIdForUser,
  listTagsByUser,
  listTagsMissingEmbeddingsByUser,
  listTagsStaleEmbeddingsByUser,
  updateTagEmbeddingById,
  updateTagLabelForUser,
} from "../sql/tag";
import {
  findUserByIdentifier,
  getUserById,
  updateUserPreferencesById,
} from "../sql/user";
import {
  createBackfillEmbeddingInputs,
  createBackfillTagEmbeddings,
  createNoteEmbeddingInput,
  createQueryEmbedding,
  createTagLabelEmbedding,
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./notes-embeddings";

export const NOTES_APP_NOTE_NOT_FOUND_ERROR = "Note not found.";
export const NOTES_APP_CATEGORY_NOT_FOUND_ERROR = "Category not found.";
export const NOTES_APP_TAG_NOT_FOUND_ERROR = "Tag not found.";
export const NOTES_APP_USER_NOT_FOUND_ERROR = "User not found.";
export const NOTES_APP_LOGIN_NOT_FOUND_ERROR =
  "No matching user was found. Enter an existing username, email, or phone number.";
export const NOTES_APP_EMBEDDING_MAINTENANCE_MISSING_MODE = "missing";
export const NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE = "stale";

const toRequestObject = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
};

const normalizeTaxonomyLabel = (value: string) => value.trim().toLocaleLowerCase();

const normalizeSearchQuery = (value: string) => value.trim().toLocaleLowerCase();

export const parsePositiveInteger = (
  value: unknown,
  fieldName: string,
  { min = 1, max }: { min?: number; max?: number } = {}
) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= min && (typeof max !== "number" || value <= max)) {
      return value;
    }
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);

    if (
      Number.isInteger(parsed) &&
      parsed >= min &&
      (typeof max !== "number" || parsed <= max)
    ) {
      return parsed;
    }
  }

  const maxText = typeof max === "number" ? ` and at most ${max}` : "";
  throw new Error(`${fieldName} must be an integer of at least ${min}${maxText}.`);
};

export const getNotesAppErrorStatus = (error: unknown) => {
  if (error instanceof EmbeddingConfigurationError) {
    return 500;
  }

  if (error instanceof EmbeddingRequestError) {
    return error.status >= 400 && error.status < 500 ? 502 : error.status;
  }

  return 400;
};

export const parseSessionRequest = (userId: unknown): SessionRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

const parseUserPreferences = (value: unknown): UserPreferences => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("preferences must be a JSON object.");
  }

  return value as UserPreferences;
};

export const parseUpdateUserPreferencesRequest = (
  value: unknown
): UpdateUserPreferencesRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    preferences: parseUserPreferences(body.preferences),
  };
};

export const parseNotesRequest = (userId: unknown): NotesRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

export const parseCategoriesRequest = (userId: unknown): CategoriesRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

export const parseTagsRequest = (userId: unknown): TagsRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

const parseLabelRequest = (value: unknown) => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    label: typeof body.label === "string" ? normalizeTaxonomyLabel(body.label) : "",
  };
};

export const parseCreateCategoryRequest = (
  value: unknown
): CreateCategoryRequest => parseLabelRequest(value);

export const parseCreateTagRequest = (
  value: unknown
): CreateTagRequest => parseLabelRequest(value);

export const parseUpdateCategoryRequest = (
  value: unknown
): UpdateCategoryRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    categoryId: parsePositiveInteger(body.categoryId, "categoryId"),
    label: typeof body.label === "string" ? normalizeTaxonomyLabel(body.label) : "",
  };
};

export const parseUpdateTagRequest = (value: unknown): UpdateTagRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    tagId: parsePositiveInteger(body.tagId, "tagId"),
    label: typeof body.label === "string" ? normalizeTaxonomyLabel(body.label) : "",
  };
};

export const parseDeleteCategoryRequest = (
  value: unknown
): DeleteCategoryRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    categoryId: parsePositiveInteger(body.categoryId, "categoryId"),
  };
};

export const parseDeleteTagRequest = (value: unknown): DeleteTagRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    tagId: parsePositiveInteger(body.tagId, "tagId"),
  };
};

export const parseSessionLookupRequest = (value: unknown): SessionLookupRequest => {
  const body = toRequestObject(value);

  return {
    identifier: typeof body.identifier === "string" ? body.identifier.trim() : "",
  };
};

export const parseCreateNoteRequest = (value: unknown): CreateNoteRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    note: parseNoteInput(body.note),
  };
};

export const parseUpdateNoteRequest = (value: unknown): UpdateNoteRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    noteId: parsePositiveInteger(body.noteId, "noteId"),
    note: parseNoteInput(body.note),
  };
};

export const parseDeleteNoteRequest = (value: unknown): DeleteNoteRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    noteId: parsePositiveInteger(body.noteId, "noteId"),
  };
};

export const parseSearchRequest = (value: unknown): SearchRequest => {
  const body = toRequestObject(value);
  const query = typeof body.query === "string" ? normalizeSearchQuery(body.query) : "";

  if (query === "") {
    throw new Error("Search query is required.");
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    query,
    limit: parsePositiveInteger(body.limit ?? NOTES_APP_SEARCH_MAX_RESULTS, "limit", {
      min: 1,
      max: NOTES_APP_SEARCH_MAX_RESULTS,
    }),
  };
};

export const parseEmbeddingMaintenanceRequest = (
  value: unknown
): EmbeddingMaintenanceRequest => {
  const body = toRequestObject(value);
  const mode =
    typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";

  if (
    mode !== NOTES_APP_EMBEDDING_MAINTENANCE_MISSING_MODE &&
    mode !== NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE
  ) {
    throw new Error(
      `mode must be "${NOTES_APP_EMBEDDING_MAINTENANCE_MISSING_MODE}" or "${NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE}".`
    );
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    mode,
    limit: parsePositiveInteger(body.limit ?? 100, "limit", {
      min: 1,
      max: 500,
    }),
  };
};

export const getNotesAppSession = async (
  request: SessionRequest
): Promise<SessionResponse | null> => {
  const user = await getUserById(request.userId);

  return user ? { user } : null;
};

export const findNotesAppSession = async (
  request: SessionLookupRequest
): Promise<SessionResponse | null> => {
  const user = await findUserByIdentifier(request.identifier);

  return user ? { user } : null;
};

export const updateNotesAppUserPreferences = async (
  request: UpdateUserPreferencesRequest
): Promise<SessionResponse | null> => {
  const user = await updateUserPreferencesById(request.userId, request.preferences);

  return user ? { user } : null;
};

export const listNotesForNotesApp = async (
  request: NotesRequest
): Promise<NotesResponse> => ({
  notes: await listNotesByUser(request.userId),
});

export const listCategoriesForNotesApp = async (
  request: CategoriesRequest
): Promise<CategoriesResponse> => ({
  categories: await listCategoriesByUser(request.userId),
});

export const listTagsForNotesApp = async (
  request: TagsRequest
): Promise<TagsResponse> => ({
  tags: await listTagsByUser(request.userId),
});

const createLabeledEntityForNotesApp = async ({
  userId,
  label,
  resolveId,
  tableName,
}: {
  userId: number;
  label: string;
  resolveId: typeof resolveTagIdForUser;
  tableName: "user_note_category_v1" | "user_note_tag_v1";
}) => {
  const trimmed = normalizeTaxonomyLabel(label);

  if (trimmed === "") {
    throw new Error("label is required.");
  }

  const client = await getDb().connect();
  let entityId: number;

  try {
    await client.query("BEGIN");
    const resolvedId = await resolveId(client, userId, trimmed);

    if (resolvedId === null) {
      throw new Error("Failed to resolve entity.");
    }

    entityId = resolvedId;
    const { vectorLiteral, embeddingModel } = await createTagLabelEmbedding(trimmed);
    const embeddingColumn =
      tableName === "user_note_category_v1" ? "category_embedding" : "tag_embedding";

    await client.query(
      `
        UPDATE public.${tableName}
        SET
          ${embeddingColumn} = $1::vector,
          embedding_model = $2,
          embedding_updated_at = $3
        WHERE id = $4
          AND user_id = $5
      `,
      [
        vectorLiteral,
        embeddingModel,
        embeddingModel ? new Date().toISOString() : null,
        entityId,
        userId,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return entityId!;
};

export const createCategoryForNotesApp = async (
  request: CreateCategoryRequest
): Promise<CreateCategoryResponse> => {
  const categoryId = await createLabeledEntityForNotesApp({
    userId: request.userId,
    label: request.label,
    resolveId: resolveCategoryIdForUser,
    tableName: "user_note_category_v1",
  });
  const category = await getCategoryByIdForUser(request.userId, categoryId);

  if (!category) {
    throw new Error("Failed to load category.");
  }

  return { category };
};

export const createTagForNotesApp = async (
  request: CreateTagRequest
): Promise<CreateTagResponse> => {
  const tagId = await createLabeledEntityForNotesApp({
    userId: request.userId,
    label: request.label,
    resolveId: resolveTagIdForUser,
    tableName: "user_note_tag_v1",
  });
  const tag = await getTagByIdForUser(request.userId, tagId);

  if (!tag) {
    throw new Error("Failed to load tag.");
  }

  return { tag };
};

const updateLabeledEntityForNotesApp = async <T>({
  userId,
  entityId,
  label,
  updateLabel,
  getById,
  tableName,
}: {
  userId: number;
  entityId: number;
  label: string;
  updateLabel: (
    client: PoolClient,
    userId: number,
    entityId: number,
    label: string
  ) => Promise<number | null>;
  getById: (userId: number, entityId: number) => Promise<T | null>;
  tableName: "user_note_category_v1" | "user_note_tag_v1";
}): Promise<T | null> => {
  const trimmed = normalizeTaxonomyLabel(label);

  if (trimmed === "") {
    throw new Error("label is required.");
  }

  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const updatedId = await updateLabel(client, userId, entityId, trimmed);

    if (updatedId === null) {
      await client.query("ROLLBACK");
      return null;
    }

    const { vectorLiteral, embeddingModel } = await createTagLabelEmbedding(trimmed);
    const embeddingColumn =
      tableName === "user_note_category_v1" ? "category_embedding" : "tag_embedding";

    await client.query(
      `
        UPDATE public.${tableName}
        SET
          ${embeddingColumn} = $1::vector,
          embedding_model = $2,
          embedding_updated_at = $3
        WHERE id = $4
          AND user_id = $5
      `,
      [
        vectorLiteral,
        embeddingModel,
        embeddingModel ? new Date().toISOString() : null,
        entityId,
        userId,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getById(userId, entityId);
};

const ensureFallbackCategoryId = async (userId: number) => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");
    const fallbackCategory = await getFirstCategoryForUser(client, userId);

    if (!fallbackCategory) {
      throw new Error("Failed to resolve fallback category.");
    }

    const fallbackCategoryId = fallbackCategory.id;

    const { vectorLiteral, embeddingModel } = await createTagLabelEmbedding(
      fallbackCategory.label
    );

    await client.query(
      `
        UPDATE public.user_note_category_v1
        SET
          category_embedding = $1::vector,
          embedding_model = $2,
          embedding_updated_at = $3
        WHERE id = $4
          AND user_id = $5
      `,
      [
        vectorLiteral,
        embeddingModel,
        embeddingModel ? new Date().toISOString() : null,
        fallbackCategoryId,
        userId,
      ]
    );

    await client.query("COMMIT");
    return fallbackCategoryId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const updateCategoryForNotesApp = async (
  request: UpdateCategoryRequest
): Promise<UpdateCategoryResponse | null> => {
  const category = await updateLabeledEntityForNotesApp({
    userId: request.userId,
    entityId: request.categoryId,
    label: request.label,
    updateLabel: updateCategoryLabelForUser,
    getById: getCategoryByIdForUser,
    tableName: "user_note_category_v1",
  });

  return category ? { category } : null;
};

export const updateTagForNotesApp = async (
  request: UpdateTagRequest
): Promise<UpdateTagResponse | null> => {
  const tag = await updateLabeledEntityForNotesApp({
    userId: request.userId,
    entityId: request.tagId,
    label: request.label,
    updateLabel: updateTagLabelForUser,
    getById: getTagByIdForUser,
    tableName: "user_note_tag_v1",
  });

  return tag ? { tag } : null;
};

export const deleteCategoryForNotesApp = async (
  request: DeleteCategoryRequest
): Promise<DeleteCategoryResponse | null> => {
  const fallbackCategoryId = await ensureFallbackCategoryId(request.userId);
  const result = await deleteCategoryForUser(
    request.userId,
    request.categoryId,
    fallbackCategoryId
  );

  if (!result.deleted) {
    return null;
  }

  return { ok: true };
};

export const deleteTagForNotesApp = async (
  request: DeleteTagRequest
): Promise<DeleteTagResponse | null> => {
  const result = await deleteTagForUser(request.userId, request.tagId);

  if (!result.deleted) {
    return null;
  }

  return { ok: true, deletedLinks: result.deletedLinks };
};

export const createNoteForNotesApp = async (
  request: CreateNoteRequest
): Promise<NoteResponse> => {
  const embeddings = await createNoteEmbeddingInput({
    description: request.note.description,
  });
  const note = await createNoteForUser(request.userId, request.note, embeddings);

  return { note };
};

export const updateNoteForNotesApp = async (
  request: UpdateNoteRequest
): Promise<NoteResponse | null> => {
  const embeddings = await createNoteEmbeddingInput({
    description: request.note.description,
  });
  const note = await updateNoteForUser(
    request.noteId,
    request.userId,
    request.note,
    embeddings
  );

  return note ? { note } : null;
};

export const deleteNoteForNotesApp = async (
  request: DeleteNoteRequest
): Promise<DeleteResponse | null> => {
  const deleted = await deleteNoteForUser(request.noteId, request.userId);

  return deleted ? { ok: true } : null;
};

export const searchNotesForNotesApp = async (
  request: SearchRequest
): Promise<SearchResponse> => {
  const queryEmbedding = await createQueryEmbedding(request.query);
  const results = await searchNotesByEmbedding(
    request.userId,
    queryEmbedding,
    request.limit
  );

  return { results };
};

export const maintainNoteEmbeddingsForNotesApp = async (
  request: EmbeddingMaintenanceRequest
): Promise<EmbeddingMaintenanceResponse> => {
  const categories =
    request.mode === NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE
      ? await listCategoriesStaleEmbeddingsByUser(request.userId, request.limit)
      : await listCategoriesMissingEmbeddingsByUser(request.userId, request.limit);

  let categoriesUpdated = 0;

  if (categories.length > 0) {
    const categoryJobs = await createBackfillTagEmbeddings(categories);

    for (const job of categoryJobs) {
      await updateCategoryEmbeddingById(
        job.tagId,
        request.userId,
        job.vectorLiteral,
        job.embeddingModel
      );
    }

    categoriesUpdated = categoryJobs.length;
  }

  const tags =
    request.mode === NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE
      ? await listTagsStaleEmbeddingsByUser(request.userId, request.limit)
      : await listTagsMissingEmbeddingsByUser(request.userId, request.limit);

  let tagsUpdated = 0;

  if (tags.length > 0) {
    const tagJobs = await createBackfillTagEmbeddings(tags);

    for (const job of tagJobs) {
      await updateTagEmbeddingById(
        job.tagId,
        request.userId,
        job.vectorLiteral,
        job.embeddingModel
      );
    }

    tagsUpdated = tagJobs.length;
  }

  const notes =
    request.mode === NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE
      ? await listNotesStaleEmbeddingsByUser(request.userId, request.limit)
      : await listNotesMissingEmbeddingsByUser(request.userId, request.limit);

  if (notes.length === 0 && tagsUpdated === 0 && categoriesUpdated === 0) {
    return {
      mode: request.mode,
      processed: 0,
      updated: 0,
      categoriesUpdated: 0,
      tagsUpdated: 0,
      hasMore: false,
    };
  }

  let notesUpdated = 0;

  if (notes.length > 0) {
    const jobs = await createBackfillEmbeddingInputs(notes);

    for (const job of jobs) {
      await updateNoteEmbeddingsForUser(job.noteId, request.userId, job.input);
    }

    notesUpdated = jobs.length;
  }

  return {
    mode: request.mode,
    processed: notes.length,
    updated: notesUpdated,
    categoriesUpdated,
    tagsUpdated,
    hasMore:
      notes.length === request.limit ||
      tags.length === request.limit ||
      categories.length === request.limit,
  };
};

export const notesAppService = {
  getNotesAppErrorStatus,
  getNotesAppSession,
  findNotesAppSession,
  updateNotesAppUserPreferences,
  listNotesForNotesApp,
  listCategoriesForNotesApp,
  listTagsForNotesApp,
  createCategoryForNotesApp,
  createTagForNotesApp,
  updateCategoryForNotesApp,
  updateTagForNotesApp,
  deleteCategoryForNotesApp,
  deleteTagForNotesApp,
  createNoteForNotesApp,
  updateNoteForNotesApp,
  deleteNoteForNotesApp,
  searchNotesForNotesApp,
  maintainNoteEmbeddingsForNotesApp,
};

export type NotesAppService = typeof notesAppService;

export {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./notes-embeddings";
