DROP INDEX IF EXISTS user_note_v1_title_embedding_hnsw_idx;

ALTER TABLE public.user_note_v1
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS title_embedding;

ALTER TABLE public.user_note_v1
  RENAME COLUMN summary TO category;

ALTER TABLE public.user_note_v1
  RENAME COLUMN summary_embedding TO category_embedding;

ALTER INDEX user_note_v1_summary_embedding_hnsw_idx
  RENAME TO user_note_v1_category_embedding_hnsw_idx;

UPDATE public.user_note_v1
SET
  content_embedding = NULL,
  embedding_model = NULL,
  embedding_updated_at = NULL
WHERE content_embedding IS NOT NULL;
