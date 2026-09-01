import type {
  TaxonomyRequest,
  TaxonomyResponse,
  TaxonomyLevelsResponse,
  MergeSessionResponse,
  TaxonomyPathRequest,
  TaxonomyPathResponse,
  TaxonomySuggestRequest,
  TaxonomySuggestResponse,
  UpdateTaxonomyLevelRequest,
  CreateTaxonomyRequest,
  CreateTaxonomyResponse,
  CreateNoteRequest,
  CreateTagRequest,
  CreateTagResponse,
  DeleteTaxonomyRequest,
  DeleteTaxonomyResponse,
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
  SessionRequest,
  SessionResponse,
  TokenLoginRequest,
  TokenLoginResponse,
  TagsRequest,
  TagsResponse,
  UpdateUserPreferencesRequest,
  UpdateTaxonomyRequest,
  UpdateTaxonomyResponse,
  UpdateNoteRequest,
  UpdateTagRequest,
  UpdateTagResponse,
  UserPreferences,
  UserSummary,
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
  selectNoteEmbeddingStateById,
  updateNoteEmbeddingsForUser,
  updateNoteForUser,
} from "../sql/note";
import { resolveTagIdForUser } from "../sql/note/shared";
import {
  deleteTaxonomyNodeForUser,
  ensureDefaultTaxonomyChainForUser,
  getFallbackGroupIdForUser,
  getTaxonomyByIdForUser,
  listTaxonomyByUser,
  listTaxonomyMissingEmbeddingsByUser,
  listTaxonomyStaleEmbeddingsByUser,
  moveTaxonomyNodeForUser,
  resolveTaxonomyIdForUser,
  resolveTaxonomyPathForUser,
  suggestTaxonomyForUser,
  updateTaxonomyEmbeddingById,
  updateTaxonomyLabelForUser,
  TAXONOMY_SIBLING_LABEL_TAKEN_ERROR,
} from "../sql/taxonomy";
import {
  ensureTaxonomyLevelsForUser,
  listTaxonomyLevelsForUser,
  updateTaxonomyLevelLabelForUser,
} from "../sql/taxonomy-level";
import {
  deleteTagForUser,
  ensureDefaultTagForUser,
  getFirstTagForUser,
  getTagByIdForUser,
  listTagsByUser,
  listTagsMissingEmbeddingsByUser,
  listTagsStaleEmbeddingsByUser,
  updateTagEmbeddingById,
  updateTagLabelForUser,
} from "../sql/tag";
import {
  createAnonymousUser,
  CLAIM_IDENTIFIER_TAKEN_ERROR,
  claimAnonymousUser,
  createApiTokenForUser,
  deleteApiToken,
  findUserIdByApiToken,
  getUserById,
  mergeAnonymousUserInto,
  updateUserPreferencesById,
  verifyUserCredentials,
} from "../sql/user";
import {
  createBackfillEmbeddingInputs,
  createBackfillLabelEmbeddings,
  createNoteEmbeddingInput,
  createQueryEmbedding,
  createLabelEmbedding,
  CURRENT_NOTE_EMBEDDING_MODEL,
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./notes-embeddings";

export const NOTES_APP_NOTE_NOT_FOUND_ERROR = "Note not found.";
export const NOTES_APP_TAXONOMY_NOT_FOUND_ERROR = "Not found.";
export const NOTES_APP_TAG_NOT_FOUND_ERROR = "Tag not found.";
export const NOTES_APP_USER_NOT_FOUND_ERROR = "User not found.";
export const NOTES_APP_INVALID_CREDENTIALS_ERROR =
  "Invalid username, email, phone, or password.";
export const NOTES_APP_AUTH_REQUIRED_ERROR = "Authentication required.";
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

  if (error instanceof Error && error.message === CLAIM_IDENTIFIER_TAKEN_ERROR) {
    return 409;
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

export const parseTaxonomyRequest = (userId: unknown): TaxonomyRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
});

const parseTaxonomyLevel = (value: unknown, { max = 3 } = {}) =>
  parsePositiveInteger(value, "level", { min: 1, max });

const parseNullableId = (value: unknown, fieldName: string) => {
  if (value === null || value === undefined) return null;
  return parsePositiveInteger(value, fieldName);
};

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

export const parseCreateTaxonomyRequest = (
  value: unknown
): CreateTaxonomyRequest => {
  const body = toRequestObject(value);
  const level = parseTaxonomyLevel(body.level);
  const parentId = parseNullableId(body.parentId, "parentId");

  // The schema enforces this too, but rejecting here gives a usable message
  // instead of a foreign-key violation.
  if (level === 1 && parentId !== null) {
    throw new Error("A top-level item cannot have a parent.");
  }
  if (level > 1 && parentId === null) {
    throw new Error("parentId is required below the top level.");
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    level,
    parentId,
    label: typeof body.label === "string" ? normalizeTaxonomyLabel(body.label) : "",
  };
};

export const parseCreateTagRequest = (
  value: unknown
): CreateTagRequest => parseLabelRequest(value);

export const parseUpdateTaxonomyRequest = (
  value: unknown
): UpdateTaxonomyRequest => {
  const body = toRequestObject(value);
  const label =
    typeof body.label === "string" ? normalizeTaxonomyLabel(body.label) : null;
  const parentId = parseNullableId(body.parentId, "parentId");

  if (label === null && parentId === null) {
    throw new Error("Provide either a new label or a new parentId.");
  }
  if (label !== null && parentId !== null) {
    throw new Error("Rename and move are separate operations.");
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    taxonomyId: parsePositiveInteger(body.taxonomyId, "taxonomyId"),
    label,
    parentId,
  };
};

export const parseUpdateTaxonomyLevelRequest = (
  value: unknown
): UpdateTaxonomyLevelRequest => {
  const body = toRequestObject(value);
  // Tier names are headings, so case is preserved; only blank is rejected.
  const label = typeof body.label === "string" ? body.label.trim() : "";

  if (label === "") {
    throw new Error("A level name is required.");
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    level: parseTaxonomyLevel(body.level, { max: 4 }),
    label,
  };
};

export const parseTaxonomyPathRequest = (
  value: unknown
): TaxonomyPathRequest => {
  const body = toRequestObject(value);
  const read = (key: "epicLabel" | "categoryLabel" | "groupLabel") => {
    const raw = body[key];
    const label = typeof raw === "string" ? normalizeTaxonomyLabel(raw) : "";
    if (label === "") throw new Error(`${key} is required.`);
    return label;
  };

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    epicLabel: read("epicLabel"),
    categoryLabel: read("categoryLabel"),
    groupLabel: read("groupLabel"),
  };
};

export const parseTaxonomySuggestRequest = (
  value: unknown
): TaxonomySuggestRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    level: parseTaxonomyLevel(body.level),
    parentId: parseNullableId(body.parentId, "parentId"),
    query:
      typeof body.query === "string" ? normalizeTaxonomyLabel(body.query) : "",
    limit: parsePositiveInteger(body.limit ?? 10, "limit", { min: 1, max: 50 }),
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

export const parseDeleteTaxonomyRequest = (
  value: unknown
): DeleteTaxonomyRequest => {
  const body = toRequestObject(value);
  const mode = typeof body.mode === "string" ? body.mode.trim() : "";

  // No default. Guessing here means silently either losing notes or moving
  // them somewhere the user did not ask for.
  if (mode !== "reassign-children" && mode !== "delete-subtree") {
    throw new Error(
      'mode must be "reassign-children" or "delete-subtree".'
    );
  }

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    taxonomyId: parsePositiveInteger(body.taxonomyId, "taxonomyId"),
    mode,
  };
};

export const parseDeleteTagRequest = (value: unknown): DeleteTagRequest => {
  const body = toRequestObject(value);

  return {
    userId: parsePositiveInteger(body.userId, "userId"),
    tagId: parsePositiveInteger(body.tagId, "tagId"),
  };
};

export interface ClaimAnonymousSessionRequest {
  username: string;
  password: string;
  email?: string;
}

export const parseClaimAnonymousSessionRequest = (
  value: unknown
): ClaimAnonymousSessionRequest => {
  const body = toRequestObject(value);

  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (username === "") {
    throw new Error("username is required.");
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    throw new Error("password must be at least 8 characters.");
  }

  let email: string | undefined;
  if (body.email !== undefined && body.email !== null) {
    if (typeof body.email !== "string") {
      throw new Error("email must be a string.");
    }
    const trimmedEmail = body.email.trim();
    if (trimmedEmail !== "") {
      if (!trimmedEmail.includes("@")) {
        throw new Error("email must be a valid email address.");
      }
      email = trimmedEmail;
    }
  }

  return { username, password, email };
};

export const parseTokenLoginRequest = (value: unknown): TokenLoginRequest => {
  const body = toRequestObject(value);

  return {
    identifier: typeof body.identifier === "string" ? body.identifier.trim() : "",
    password: typeof body.password === "string" ? body.password : "",
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

  return user ? await withTaxonomyLevels(user) : null;
};

export const loginNotesAppUser = async (
  request: TokenLoginRequest
): Promise<TokenLoginResponse | null> => {
  const user = await verifyUserCredentials(request.identifier, request.password);

  if (!user) {
    return null;
  }

  const token = await createApiTokenForUser(user.id);
  return { token, user };
};

export const getNotesAppUserIdForToken = async (request: {
  token: string;
}): Promise<number | null> => {
  if (request.token === "") {
    return null;
  }

  return findUserIdByApiToken(request.token);
};

export const revokeNotesAppToken = async (request: {
  token: string;
}): Promise<boolean> => {
  if (request.token === "") {
    return false;
  }

  return deleteApiToken(request.token);
};

export const updateNotesAppUserPreferences = async (
  request: UpdateUserPreferencesRequest
): Promise<SessionResponse | null> => {
  const user = await updateUserPreferencesById(request.userId, request.preferences);

  return user ? await withTaxonomyLevels(user) : null;
};

export const listNotesForNotesApp = async (
  request: NotesRequest
): Promise<NotesResponse> => ({
  notes: await listNotesByUser(request.userId),
});

/**
 * The whole tree plus this user's tier vocabulary.
 *
 * Both repairs run first. A user with no vocabulary cannot have any taxonomy
 * row at all (the composite level FK forbids it), and a user with no chain has
 * nowhere to put a note, which the client experiences as autosave silently
 * doing nothing.
 */
export const listTaxonomyForNotesApp = async (
  request: TaxonomyRequest
): Promise<TaxonomyResponse> => {
  const client = await getDb().connect();

  try {
    await ensureTaxonomyLevelsForUser(client, request.userId);
    await ensureDefaultTaxonomyChainForUser(client, request.userId);
  } finally {
    client.release();
  }

  const [taxonomy, levels] = await Promise.all([
    listTaxonomyByUser(request.userId),
    listTaxonomyLevelsForUser(request.userId),
  ]);

  return { taxonomy, levels };
};

export const listTaxonomyLevelsForNotesApp = async (
  request: TaxonomyRequest
): Promise<TaxonomyLevelsResponse> => {
  const client = await getDb().connect();

  try {
    await ensureTaxonomyLevelsForUser(client, request.userId);
  } finally {
    client.release();
  }

  return { levels: await listTaxonomyLevelsForUser(request.userId) };
};

export const updateTaxonomyLevelForNotesApp = async (
  request: UpdateTaxonomyLevelRequest
): Promise<TaxonomyLevelsResponse | null> => {
  const updated = await updateTaxonomyLevelLabelForUser(
    request.userId,
    request.level,
    request.label
  );

  if (!updated) return null;

  return { levels: await listTaxonomyLevelsForUser(request.userId) };
};

export const listTagsForNotesApp = async (
  request: TagsRequest
): Promise<TagsResponse> => {
  const client = await getDb().connect();

  try {
    await ensureDefaultTagForUser(client, request.userId);
  } finally {
    client.release();
  }

  return {
    tags: await listTagsByUser(request.userId),
  };
};

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
    const { vectorLiteral, embeddingModel } = await createLabelEmbedding(trimmed);
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

export const createTaxonomyForNotesApp = async (
  request: CreateTaxonomyRequest
): Promise<CreateTaxonomyResponse> => {
  const trimmed = normalizeTaxonomyLabel(request.label);
  if (trimmed === "") throw new Error("label is required.");

  const client = await getDb().connect();
  let taxonomyId: number;

  try {
    await client.query("BEGIN");
    const resolved = await resolveTaxonomyIdForUser(
      client,
      request.userId,
      request.level,
      request.parentId,
      trimmed
    );
    if (resolved === null) throw new Error("Failed to resolve taxonomy row.");
    taxonomyId = resolved;

    const { vectorLiteral, embeddingModel } = await createLabelEmbedding(trimmed);
    await client.query(
      `
        UPDATE public.user_taxonomy_v1
        SET
          label_embedding = $1::vector,
          embedding_model = $2,
          embedding_updated_at = $3
        WHERE id = $4
          AND user_id = $5
      `,
      [
        vectorLiteral,
        embeddingModel,
        embeddingModel ? new Date().toISOString() : null,
        taxonomyId,
        request.userId,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const taxonomy = await getTaxonomyByIdForUser(request.userId, taxonomyId);
  if (!taxonomy) throw new Error("Failed to load taxonomy row.");

  return { taxonomy };
};

export const resolveTaxonomyPathForNotesApp = async (
  request: TaxonomyPathRequest
): Promise<TaxonomyPathResponse> => {
  const { epicId, categoryId, groupId } = await resolveTaxonomyPathForUser(
    request.userId,
    request.epicLabel,
    request.categoryLabel,
    request.groupLabel
  );

  const [epic, category, group] = await Promise.all([
    getTaxonomyByIdForUser(request.userId, epicId),
    getTaxonomyByIdForUser(request.userId, categoryId),
    getTaxonomyByIdForUser(request.userId, groupId),
  ]);

  if (!epic || !category || !group) {
    throw new Error("Failed to load the resolved path.");
  }

  // Best-effort: a path resolved mid-save must not fail because Jina is down.
  // Embedding maintenance picks up anything missed here.
  void backfillTaxonomyEmbeddings(request.userId, [epic.id, category.id, group.id]);

  return { epic, category, group };
};

export const suggestTaxonomyForNotesApp = async (
  request: TaxonomySuggestRequest
): Promise<TaxonomySuggestResponse> => {
  // Literal matching always works; the embedding is an enhancement, so a Jina
  // failure degrades autocomplete rather than breaking it.
  let queryEmbedding: string | null = null;
  if (request.query.length >= 3) {
    try {
      queryEmbedding = await createQueryEmbedding(request.query);
    } catch {
      queryEmbedding = null;
    }
  }

  return {
    suggestions: await suggestTaxonomyForUser(
      request.userId,
      request.level,
      request.parentId,
      request.query,
      request.limit,
      queryEmbedding
    ),
  };
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

    const { vectorLiteral, embeddingModel } = await createLabelEmbedding(trimmed);
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

const ensureFallbackTagId = async (userId: number) => {
  const client = await getDb().connect();

  try {
    await ensureDefaultTagForUser(client, userId);
    const fallbackTag = await getFirstTagForUser(client, userId);

    if (!fallbackTag) {
      throw new Error("Failed to resolve fallback tag.");
    }

    return fallbackTag.id;
  } finally {
    client.release();
  }
};

/** Rename or move one taxonomy row. Renaming re-embeds; moving does not. */
export const updateTaxonomyForNotesApp = async (
  request: UpdateTaxonomyRequest
): Promise<UpdateTaxonomyResponse | null> => {
  if (request.parentId !== null) {
    const moved = await moveTaxonomyNodeForUser(
      request.userId,
      request.taxonomyId,
      request.parentId
    );
    if (moved === null) return null;

    const taxonomy = await getTaxonomyByIdForUser(request.userId, request.taxonomyId);
    return taxonomy ? { taxonomy } : null;
  }

  const trimmed = normalizeTaxonomyLabel(request.label ?? "");
  if (trimmed === "") throw new Error("label is required.");

  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const updatedId = await updateTaxonomyLabelForUser(
      client,
      request.userId,
      request.taxonomyId,
      trimmed
    );

    if (updatedId === null) {
      await client.query("ROLLBACK");
      return null;
    }

    const { vectorLiteral, embeddingModel } = await createLabelEmbedding(trimmed);
    await client.query(
      `
        UPDATE public.user_taxonomy_v1
        SET
          label_embedding = $1::vector,
          embedding_model = $2,
          embedding_updated_at = $3
        WHERE id = $4
          AND user_id = $5
      `,
      [
        vectorLiteral,
        embeddingModel,
        embeddingModel ? new Date().toISOString() : null,
        request.taxonomyId,
        request.userId,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new Error(TAXONOMY_SIBLING_LABEL_TAKEN_ERROR);
    }
    throw error;
  } finally {
    client.release();
  }

  const taxonomy = await getTaxonomyByIdForUser(request.userId, request.taxonomyId);
  return taxonomy ? { taxonomy } : null;
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

export const deleteTaxonomyForNotesApp = async (
  request: DeleteTaxonomyRequest
): Promise<DeleteTaxonomyResponse | null> => {
  const result = await deleteTaxonomyNodeForUser(
    request.userId,
    request.taxonomyId,
    request.mode
  );

  if (!result.deleted) return null;

  return {
    ok: true,
    deletedNotes: result.deletedNotes,
    deletedNodes: result.deletedNodes,
  };
};

export const deleteTagForNotesApp = async (
  request: DeleteTagRequest
): Promise<DeleteTagResponse | null> => {
  const protectedTagId = await ensureFallbackTagId(request.userId);
  const result = await deleteTagForUser(
    request.userId,
    request.tagId,
    protectedTagId
  );

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

const normalizeDescriptionForCompare = (value: string | null | undefined) =>
  (value ?? "").trim();

/**
 * Whether this update can reuse the stored embedding instead of paying for a
 * Jina round-trip. All three conditions matter:
 *
 * 1. the description is unchanged — anything else is a new document;
 * 2. an embedding actually exists — a create whose Jina call failed, or a row
 *    inserted by the anonymous merge (which bypasses embed-on-write), must
 *    still get repaired by ordinary editing;
 * 3. it was written by the current model — otherwise notes would stop
 *    migrating when the model is bumped.
 *
 * Conditions 2 and 3 mirror what `listNotesStaleEmbeddingsByUser` treats as
 * needing work, so a skip only ever happens when the stored vector is already
 * what a reindex would produce.
 */
const canReuseStoredEmbedding = (
  stored: {
    description: string | null;
    has_embedding: boolean;
    embedding_model: string | null;
  } | null,
  nextDescription: string | null | undefined
) => {
  if (!stored) return false;
  if (
    normalizeDescriptionForCompare(stored.description) !==
    normalizeDescriptionForCompare(nextDescription)
  ) {
    return false;
  }
  // An empty description has no embedding by design; there is nothing to reuse
  // and nothing to write.
  if (normalizeDescriptionForCompare(nextDescription) === "") {
    return stored.embedding_model === null && !stored.has_embedding;
  }
  return stored.has_embedding && stored.embedding_model === CURRENT_NOTE_EMBEDDING_MODEL;
};

export const updateNoteForNotesApp = async (
  request: UpdateNoteRequest
): Promise<NoteResponse | null> => {
  const stored = await selectNoteEmbeddingStateById(
    request.noteId,
    request.userId
  );

  // Sidebar moves and due-date edits are description-preserving, and they were
  // previously paying for a full re-embed.
  const reuseStored = canReuseStoredEmbedding(stored, request.note.description);

  if (reuseStored) {
    const note = await updateNoteForUser(
      request.noteId,
      request.userId,
      request.note,
      null,
      stored?.description ?? null
    );

    // The row still matched the description the skip was decided from, so the
    // stored vector genuinely describes the stored text.
    if (note) return { note };

    // Either the note is gone or another client changed its description
    // between the read above and this write. Falling through re-embeds, which
    // is correct in the first case (it simply finds nothing) and required in
    // the second, where reusing the old vector would leave the note and its
    // embedding describing different text.
  }

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
  const taxonomy =
    request.mode === NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE
      ? await listTaxonomyStaleEmbeddingsByUser(request.userId, request.limit)
      : await listTaxonomyMissingEmbeddingsByUser(request.userId, request.limit);

  let taxonomyUpdated = 0;

  if (taxonomy.length > 0) {
    const taxonomyJobs = await createBackfillLabelEmbeddings(taxonomy);

    for (const job of taxonomyJobs) {
      await updateTaxonomyEmbeddingById(
        job.id,
        request.userId,
        job.vectorLiteral,
        job.embeddingModel
      );
    }

    taxonomyUpdated = taxonomyJobs.length;
  }

  const tags =
    request.mode === NOTES_APP_EMBEDDING_MAINTENANCE_STALE_MODE
      ? await listTagsStaleEmbeddingsByUser(request.userId, request.limit)
      : await listTagsMissingEmbeddingsByUser(request.userId, request.limit);

  let tagsUpdated = 0;

  if (tags.length > 0) {
    const tagJobs = await createBackfillLabelEmbeddings(tags);

    for (const job of tagJobs) {
      await updateTagEmbeddingById(
        job.id,
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

  if (notes.length === 0 && tagsUpdated === 0 && taxonomyUpdated === 0) {
    return {
      mode: request.mode,
      processed: 0,
      updated: 0,
      taxonomyUpdated: 0,
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
    taxonomyUpdated,
    tagsUpdated,
    hasMore:
      notes.length === request.limit ||
      tags.length === request.limit ||
      taxonomy.length === request.limit,
  };
};

/**
 * Embed a handful of taxonomy labels without blocking the caller.
 *
 * Used where a path is resolved as part of saving a note: autocomplete quality
 * is not worth failing a save for, and embedding maintenance sweeps up anything
 * this misses.
 */
const backfillTaxonomyEmbeddings = async (userId: number, ids: number[]) => {
  try {
    const rows = await Promise.all(
      ids.map((id) => getTaxonomyByIdForUser(userId, id))
    );
    const present = rows.filter((row): row is NonNullable<typeof row> => row !== null);
    if (present.length === 0) return;

    const jobs = await createBackfillLabelEmbeddings(
      present.map((row) => ({ id: row.id, label: row.label }))
    );

    for (const job of jobs) {
      await updateTaxonomyEmbeddingById(
        job.id,
        userId,
        job.vectorLiteral,
        job.embeddingModel
      );
    }
  } catch (error) {
    console.warn(
      `Taxonomy embedding backfill failed for user ${userId}; ` +
        "autocomplete stays literal-only until embedding maintenance runs.",
      error
    );
  }
};

/**
 * Every session response carries the tier vocabulary, so no client ever paints
 * default English tier names and corrects itself a moment later.
 */
const withTaxonomyLevels = async (user: UserSummary): Promise<SessionResponse> => {
  const client = await getDb().connect();
  try {
    await ensureTaxonomyLevelsForUser(client, user.id);
  } finally {
    client.release();
  }

  return { user, taxonomyLevels: await listTaxonomyLevelsForUser(user.id) };
};

export const createAnonymousNotesAppSession = async (): Promise<SessionResponse> => {
  const user = await createAnonymousUser();
  return withTaxonomyLevels(user);
};

export const claimAnonymousNotesAppSession = async (request: {
  anonUserId: number;
  username: string;
  password: string;
  email?: string;
}): Promise<SessionResponse> => {
  const user = await claimAnonymousUser(request.anonUserId, {
    username: request.username,
    password: request.password,
    email: request.email,
  });

  return withTaxonomyLevels(user);
};

export const mergeAnonymousNotesAppSession = async (request: {
  anonUserId: number;
  realUserId: number;
}): Promise<MergeSessionResponse> => {
  const remaps = await mergeAnonymousUserInto(request.anonUserId, request.realUserId);

  // Categories/tags inserted by the merge bypass the embed-on-write service
  // paths, so their embeddings are NULL and they would be invisible to
  // semantic search until maintenance runs. Backfill them now, best-effort:
  // the merge has already committed and must stay successful even when Jina
  // is unconfigured (missing JINA_API_KEY) or unavailable.
  try {
    await maintainNoteEmbeddingsForNotesApp({
      userId: request.realUserId,
      mode: NOTES_APP_EMBEDDING_MAINTENANCE_MISSING_MODE,
      limit: 100,
    });
  } catch (error) {
    console.warn(
      `Embedding backfill after anonymous merge failed for user ${request.realUserId}; ` +
        "merged categories/tags stay unsearchable until embedding maintenance runs.",
      error
    );
  }

  const user = await getUserById(request.realUserId);
  if (!user) {
    throw new Error("Real user not found after merge.");
  }

  return { ...(await withTaxonomyLevels(user)), remaps };
};

export const notesAppService = {
  getNotesAppErrorStatus,
  getNotesAppSession,
  loginNotesAppUser,
  getNotesAppUserIdForToken,
  revokeNotesAppToken,
  updateNotesAppUserPreferences,
  listNotesForNotesApp,
  listTaxonomyForNotesApp,
  listTaxonomyLevelsForNotesApp,
  updateTaxonomyLevelForNotesApp,
  listTagsForNotesApp,
  createTaxonomyForNotesApp,
  resolveTaxonomyPathForNotesApp,
  suggestTaxonomyForNotesApp,
  createTagForNotesApp,
  updateTaxonomyForNotesApp,
  updateTagForNotesApp,
  deleteTaxonomyForNotesApp,
  deleteTagForNotesApp,
  createNoteForNotesApp,
  updateNoteForNotesApp,
  deleteNoteForNotesApp,
  searchNotesForNotesApp,
  maintainNoteEmbeddingsForNotesApp,
  createAnonymousNotesAppSession,
  claimAnonymousNotesAppSession,
  mergeAnonymousNotesAppSession,
};

export type NotesAppService = typeof notesAppService;

export {
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./notes-embeddings";
