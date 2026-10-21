-- Drop unused content_embedding column from user_note_v1.
--
-- The search query (gets.ts searchNotesByEmbedding) ranks notes using
-- description_embedding + category_embedding on the category table.
-- content_embedding was computed but never queried, wasting an embedding
-- API call per note create/update and storage for a vector(1024) column
-- plus its HNSW index.

DROP INDEX IF EXISTS public.user_note_v1_content_embedding_hnsw_idx;

ALTER TABLE public.user_note_v1
  DROP COLUMN IF EXISTS content_embedding;
