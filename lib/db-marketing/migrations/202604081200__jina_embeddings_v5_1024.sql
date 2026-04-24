-- Switch from OpenAI text-embedding-3-small (1536 dims) to
-- Jina AI jina-embeddings-v5-text-small (1024 dims).
--
-- 1. Drop existing HNSW indexes (dimension-specific).
-- 2. Alter vector columns from vector(1536) to vector(1024).
-- 3. Nullify all existing embeddings (must be regenerated with new model).
-- 4. Recreate HNSW indexes for the new dimension.

-- user_note_v1: content_embedding, description_embedding
DROP INDEX IF EXISTS public.user_note_v1_content_embedding_hnsw_idx;
DROP INDEX IF EXISTS public.user_note_v1_description_embedding_hnsw_idx;

ALTER TABLE public.user_note_v1
  ALTER COLUMN content_embedding TYPE vector(1024) USING NULL::vector(1024),
  ALTER COLUMN description_embedding TYPE vector(1024) USING NULL::vector(1024),
  ALTER COLUMN embedding_model SET DEFAULT NULL;

UPDATE public.user_note_v1
SET content_embedding = NULL,
    description_embedding = NULL,
    embedding_model = NULL,
    embedding_updated_at = NULL;

CREATE INDEX user_note_v1_content_embedding_hnsw_idx
  ON public.user_note_v1 USING hnsw (content_embedding public.vector_cosine_ops);

CREATE INDEX user_note_v1_description_embedding_hnsw_idx
  ON public.user_note_v1 USING hnsw (description_embedding public.vector_cosine_ops);

-- user_note_category_v1: category_embedding
DROP INDEX IF EXISTS public.user_note_category_v1_category_embedding_hnsw_idx;

ALTER TABLE public.user_note_category_v1
  ALTER COLUMN category_embedding TYPE vector(1024) USING NULL::vector(1024),
  ALTER COLUMN embedding_model SET DEFAULT NULL;

UPDATE public.user_note_category_v1
SET category_embedding = NULL,
    embedding_model = NULL,
    embedding_updated_at = NULL;

CREATE INDEX user_note_category_v1_category_embedding_hnsw_idx
  ON public.user_note_category_v1 USING hnsw (category_embedding public.vector_cosine_ops);
