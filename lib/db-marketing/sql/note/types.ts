export type {
  NoteCategoryRef,
  NoteTagRef,
  NoteInput,
  NoteRecord,
  SemanticSearchResult,
  WorkflowStatusRef,
} from "../../contracts/notes-app";

export interface NoteEmbeddingWriteInput {
  descriptionEmbedding: string | null;
  embeddingModel: string | null;
}

export interface NoteEmbeddingBackfillRow {
  id: number;
  description: string | null;
}
