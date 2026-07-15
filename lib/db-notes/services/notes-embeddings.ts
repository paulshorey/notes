import type { NoteEmbeddingWriteInput } from "../sql/note/types";

/**
 * Embedding constants and text-building logic below are shared with
 * scripts/regenerate-embeddings.mjs — keep both files in sync when
 * changing the model, dimensions, or text format.
 *
 * Provider: Jina AI  —  Model: jina-embeddings-v5-text-small (1024 dims)
 *
 * Jina v5 supports task-specific LoRA adapters:
 *   retrieval.query   – for search queries (asymmetric)
 *   retrieval.passage  – for stored documents / passages (asymmetric)
 *   text-matching      – for symmetric similarity
 *
 * We use retrieval.passage when embedding note descriptions / tags
 * and retrieval.query when embedding user search queries. This
 * asymmetric approach significantly improves search quality for
 * short phrases.
 */
const JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings";
const JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small";
const JINA_EMBEDDING_DIMENSIONS = 1024;
export const CURRENT_NOTE_EMBEDDING_MODEL = `${JINA_EMBEDDING_MODEL}:notes-v3`;

interface JinaEmbeddingItem {
  index: number;
  embedding: number[];
}

interface JinaEmbeddingsResponse {
  data?: JinaEmbeddingItem[];
  detail?: string;
}

export interface NoteEmbeddingJob {
  noteId: number;
  input: NoteEmbeddingWriteInput;
}

export class EmbeddingConfigurationError extends Error {}

export class EmbeddingRequestError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "EmbeddingRequestError";
    this.status = status;
  }
}

const normalizeText = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\r\n/g, "\n").trim();
};

const toVectorLiteral = (embedding: number[]) => JSON.stringify(embedding);

const assertEmbeddingDimensions = (embedding: number[]) => {
  if (embedding.length !== JINA_EMBEDDING_DIMENSIONS) {
    throw new EmbeddingRequestError(
      `Jina returned ${embedding.length} dimensions, expected ${JINA_EMBEDDING_DIMENSIONS}.`
    );
  }
};

const getApiKey = () => {
  const apiKey = process.env.JINA_API_KEY?.trim();

  if (!apiKey) {
    throw new EmbeddingConfigurationError("JINA_API_KEY environment variable not set.");
  }

  return apiKey;
};

type JinaTask = "retrieval.query" | "retrieval.passage" | "text-matching";

const fetchEmbeddings = async (inputs: string[], task: JinaTask) => {
  if (inputs.length === 0) {
    return [];
  }

  const response = await fetch(JINA_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: JINA_EMBEDDING_MODEL,
      input: inputs,
      task,
      dimensions: JINA_EMBEDDING_DIMENSIONS,
      normalized: true,
      truncate: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const payload = (await response.json().catch(() => null)) as JinaEmbeddingsResponse | null;

  if (!response.ok) {
    throw new EmbeddingRequestError(
      payload?.detail ?? "Jina embeddings request failed.",
      response.status
    );
  }

  if (!payload?.data || payload.data.length !== inputs.length) {
    throw new EmbeddingRequestError("Jina returned an unexpected embeddings payload.");
  }

  const embeddings = [...payload.data]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);

  embeddings.forEach(assertEmbeddingDimensions);

  return embeddings;
};

const emptyEmbeddingInput = (): NoteEmbeddingWriteInput => ({
  descriptionEmbedding: null,
  embeddingModel: null,
});

export const createNoteEmbeddingInput = async (
  note: { description: string | null }
): Promise<NoteEmbeddingWriteInput> => {
  const description = normalizeText(note.description);

  if (description === "") {
    return emptyEmbeddingInput();
  }

  const embeddings = await fetchEmbeddings([description], "retrieval.passage");
  const embedding = embeddings[0];

  if (!embedding) {
    throw new EmbeddingRequestError("Jina returned too few embeddings.");
  }

  return {
    descriptionEmbedding: toVectorLiteral(embedding),
    embeddingModel: CURRENT_NOTE_EMBEDDING_MODEL,
  };
};

export const createTagLabelEmbedding = async (label: string) => {
  const trimmed = normalizeText(label);

  if (trimmed === "") {
    return {
      vectorLiteral: null as string | null,
      embeddingModel: null as string | null,
    };
  }

  const embeddings = await fetchEmbeddings([trimmed], "retrieval.passage");
  const embedding = embeddings[0];

  if (!embedding) {
    throw new EmbeddingRequestError("Jina returned no embedding for the tag label.");
  }

  return {
    vectorLiteral: toVectorLiteral(embedding),
    embeddingModel: CURRENT_NOTE_EMBEDDING_MODEL,
  };
};

export const createQueryEmbedding = async (query: string) => {
  const trimmed = normalizeText(query);

  if (trimmed === "") {
    throw new Error("Search query is required.");
  }

  const embeddings = await fetchEmbeddings([trimmed], "retrieval.query");
  const embedding = embeddings[0];

  if (!embedding) {
    throw new EmbeddingRequestError("Jina returned no embedding for the search query.");
  }

  return toVectorLiteral(embedding);
};

export interface TagEmbeddingJob {
  tagId: number;
  vectorLiteral: string | null;
  embeddingModel: string | null;
}

export const createBackfillTagEmbeddings = async (
  tags: Array<{ id: number; label: string }>
): Promise<TagEmbeddingJob[]> => {
  const trimmed = tags.map((c) => ({
    id: c.id,
    text: normalizeText(c.label),
  }));

  const nonEmpty = trimmed.filter((c) => c.text !== "");

  if (nonEmpty.length === 0) {
    return tags.map((c) => ({
      tagId: c.id,
      vectorLiteral: null,
      embeddingModel: null,
    }));
  }

  const embeddings = await fetchEmbeddings(
    nonEmpty.map((c) => c.text),
    "retrieval.passage"
  );

  const vectorMap = new Map<number, string>();
  nonEmpty.forEach((c, index) => {
    const embedding = embeddings[index];

    if (!embedding) {
      throw new EmbeddingRequestError(
        "Jina returned too few embeddings during tag backfill."
      );
    }

    vectorMap.set(c.id, toVectorLiteral(embedding));
  });

  return tags.map((c) => ({
    tagId: c.id,
    vectorLiteral: vectorMap.get(c.id) ?? null,
    embeddingModel: vectorMap.has(c.id) ? CURRENT_NOTE_EMBEDDING_MODEL : null,
  }));
};

export const createBackfillEmbeddingInputs = async (
  notes: Array<{ id: number; description: string | null }>
): Promise<NoteEmbeddingJob[]> => {
  const requests: Array<{ noteId: number; text: string }> = [];

  for (const note of notes) {
    const description = normalizeText(note.description);

    if (description !== "") {
      requests.push({ noteId: note.id, text: description });
    }
  }

  if (requests.length === 0) {
    return notes.map((note) => ({
      noteId: note.id,
      input: emptyEmbeddingInput(),
    }));
  }

  const embeddings = await fetchEmbeddings(
    requests.map((r) => r.text),
    "retrieval.passage"
  );

  const vectorMap = new Map<number, string>();
  requests.forEach((request, index) => {
    const embedding = embeddings[index];

    if (!embedding) {
      throw new EmbeddingRequestError("Jina returned too few embeddings during backfill.");
    }

    vectorMap.set(request.noteId, toVectorLiteral(embedding));
  });

  return notes.map((note) => ({
    noteId: note.id,
    input: vectorMap.has(note.id)
      ? {
          descriptionEmbedding: vectorMap.get(note.id)!,
          embeddingModel: CURRENT_NOTE_EMBEDDING_MODEL,
        }
      : emptyEmbeddingInput(),
  }));
};
