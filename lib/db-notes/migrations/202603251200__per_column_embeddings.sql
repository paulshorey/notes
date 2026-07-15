ALTER TABLE public.user_note_v1
  ADD COLUMN summary_embedding vector(1536),
  ADD COLUMN description_embedding vector(1536);

CREATE INDEX user_note_v1_summary_embedding_hnsw_idx
  ON public.user_note_v1
  USING hnsw (summary_embedding vector_cosine_ops);

CREATE INDEX user_note_v1_description_embedding_hnsw_idx
  ON public.user_note_v1
  USING hnsw (description_embedding vector_cosine_ops);
