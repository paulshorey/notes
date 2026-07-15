ALTER TABLE public.user_note_category_v1
  ADD COLUMN category_embedding public.vector(1536),
  ADD COLUMN embedding_model text,
  ADD COLUMN embedding_updated_at timestamp with time zone;

CREATE TABLE public.user_note_category_link_v1 (
  note_id integer NOT NULL,
  category_id integer NOT NULL,
  CONSTRAINT user_note_category_link_v1_pkey PRIMARY KEY (note_id, category_id),
  CONSTRAINT user_note_category_link_v1_note_id_fkey
    FOREIGN KEY (note_id) REFERENCES public.user_note_v1(id) ON DELETE CASCADE,
  CONSTRAINT user_note_category_link_v1_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.user_note_category_v1(id) ON DELETE CASCADE
);

CREATE INDEX user_note_category_link_v1_category_id_idx
  ON public.user_note_category_link_v1 (category_id);

INSERT INTO public.user_note_category_link_v1 (note_id, category_id)
SELECT n.id, n.category
FROM public.user_note_v1 n
WHERE n.category IS NOT NULL;

UPDATE public.user_note_category_v1 AS c
SET
  category_embedding = s.category_embedding,
  embedding_model = s.embedding_model,
  embedding_updated_at = s.embedding_updated_at
FROM (
  SELECT DISTINCT ON (n.category)
    n.category AS cid,
    n.category_embedding,
    n.embedding_model,
    n.embedding_updated_at
  FROM public.user_note_v1 n
  WHERE n.category IS NOT NULL
    AND n.category_embedding IS NOT NULL
  ORDER BY n.category, n.id
) AS s
WHERE c.id = s.cid;

ALTER TABLE public.user_note_v1 DROP CONSTRAINT user_note_v1_category_fkey;

DROP INDEX IF EXISTS public.user_note_v1_category_embedding_hnsw_idx;

ALTER TABLE public.user_note_v1
  DROP COLUMN category,
  DROP COLUMN category_embedding;

CREATE INDEX user_note_category_v1_category_embedding_hnsw_idx
  ON public.user_note_category_v1 USING hnsw (category_embedding public.vector_cosine_ops);
