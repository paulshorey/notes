CREATE TABLE public.user_note_category_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    category_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    CONSTRAINT user_note_category_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,
    CONSTRAINT user_note_category_v1_user_id_label_key UNIQUE (user_id, label)
);

CREATE INDEX user_note_category_v1_user_id_idx
  ON public.user_note_category_v1 (user_id);

CREATE INDEX user_note_category_v1_category_embedding_hnsw_idx
  ON public.user_note_category_v1 USING hnsw (category_embedding public.vector_cosine_ops);

CREATE TRIGGER user_note_category_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_note_category_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();

INSERT INTO public.user_note_category_v1 (user_id, label)
SELECT DISTINCT n.user_id, 'Uncategorized'
FROM public.user_note_v1 n
ON CONFLICT (user_id, label) DO NOTHING;

ALTER TABLE public.user_note_v1
  ADD COLUMN category_id integer;

UPDATE public.user_note_v1 AS n
SET category_id = c.id
FROM public.user_note_category_v1 AS c
WHERE c.user_id = n.user_id
  AND c.label = 'Uncategorized'
  AND n.category_id IS NULL;

ALTER TABLE public.user_note_v1
  ALTER COLUMN category_id SET NOT NULL;

ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.user_note_category_v1(id) ON DELETE RESTRICT;

CREATE INDEX user_note_v1_category_id_idx
  ON public.user_note_v1 (category_id);
