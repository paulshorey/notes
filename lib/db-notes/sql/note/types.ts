export type {
  NoteCategoryRef,
  NoteTagRef,
  NoteInput,
  NoteRecord,
  SemanticSearchResult,
} from "../../contracts/notes-app";

export interface NoteEmbeddingWriteInput {
  descriptionEmbedding: string | null;
  embeddingModel: string | null;
}

export interface NoteEmbeddingBackfillRow {
  id: number;
  description: string | null;
}
