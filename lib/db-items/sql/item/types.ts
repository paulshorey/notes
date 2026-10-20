export type {
  CategoryRef,
  TagRef,
  ItemInput,
  ItemRecord,
  SemanticSearchResult,
} from "../../contracts/items-app"

export interface ItemEmbeddingWriteInput {
  descriptionEmbedding: string | null
  embeddingModel: string | null
}

export interface ItemEmbeddingBackfillRow {
  id: number
  description: string | null
}
