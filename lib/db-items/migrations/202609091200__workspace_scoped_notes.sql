-- The strict-taxonomy experiment was intentionally rolled back in code, and all
-- existing note content is demo data. Replace the content model in one cutover
-- while preserving users, credentials, preferences, and API tokens.

DROP TABLE IF EXISTS public.user_note_category_link_v1 CASCADE;
DROP TABLE IF EXISTS public.user_note_tag_link_v1 CASCADE;
DROP TABLE IF EXISTS public.user_note_v1 CASCADE;
DROP TABLE IF EXISTS public.user_note_category_v1 CASCADE;
DROP TABLE IF EXISTS public.user_note_tag_v1 CASCADE;
DROP TABLE IF EXISTS public.user_taxonomy_v1 CASCADE;
DROP TABLE IF EXISTS public.user_taxonomy_level_v1 CASCADE;
DROP TABLE IF EXISTS public.user_workflow_status_v1 CASCADE;

CREATE TABLE public.user_workspace_v1 (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.user_v1(id) ON DELETE CASCADE,
  label text NOT NULL,
  time_created timestamptz NOT NULL DEFAULT now(),
  time_modified timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_workspace_v1_user_id_label_key UNIQUE (user_id, label),
  CONSTRAINT user_workspace_v1_id_user_id_key UNIQUE (id, user_id),
  CONSTRAINT user_workspace_v1_label_normalized_check
    CHECK (label <> '' AND label = lower(btrim(label)))
);

CREATE TABLE public.workspace_note_category_v1 (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE,
  label text NOT NULL,
  category_embedding public.vector(1024),
  embedding_model text,
  embedding_updated_at timestamptz,
  time_created timestamptz NOT NULL DEFAULT now(),
  time_modified timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_note_category_v1_workspace_id_label_key UNIQUE (workspace_id, label),
  CONSTRAINT workspace_note_category_v1_id_workspace_id_key UNIQUE (id, workspace_id),
  CONSTRAINT workspace_note_category_v1_label_normalized_check
    CHECK (label <> '' AND label = lower(btrim(label)))
);

CREATE TABLE public.workspace_note_status_v1 (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  time_created timestamptz NOT NULL DEFAULT now(),
  time_modified timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_note_status_v1_workspace_id_label_key UNIQUE (workspace_id, label),
  CONSTRAINT workspace_note_status_v1_id_workspace_id_key UNIQUE (id, workspace_id),
  CONSTRAINT workspace_note_status_v1_label_normalized_check
    CHECK (label <> '' AND label = lower(btrim(label)))
);

CREATE TABLE public.workspace_note_tag_v1 (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE,
  label text NOT NULL,
  tag_embedding public.vector(1024),
  embedding_model text,
  embedding_updated_at timestamptz,
  time_created timestamptz NOT NULL DEFAULT now(),
  time_modified timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_note_tag_v1_workspace_id_label_key UNIQUE (workspace_id, label),
  CONSTRAINT workspace_note_tag_v1_id_workspace_id_key UNIQUE (id, workspace_id),
  CONSTRAINT workspace_note_tag_v1_label_normalized_check
    CHECK (label <> '' AND label = lower(btrim(label)))
);

CREATE TABLE public.user_note_v1 (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE,
  status_id integer,
  description text,
  time_due timestamptz,
  time_remind timestamptz,
  description_embedding public.vector(1024),
  embedding_model text,
  embedding_updated_at timestamptz,
  time_created timestamptz NOT NULL DEFAULT now(),
  time_modified timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_note_v1_id_workspace_id_key UNIQUE (id, workspace_id),
  CONSTRAINT user_note_v1_status_workspace_fkey
    FOREIGN KEY (status_id, workspace_id)
    REFERENCES public.workspace_note_status_v1(id, workspace_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.user_note_category_link_v1 (
  note_id integer NOT NULL,
  category_id integer NOT NULL,
  workspace_id integer NOT NULL,
  CONSTRAINT user_note_category_link_v1_pkey PRIMARY KEY (note_id, category_id),
  CONSTRAINT user_note_category_link_v1_note_workspace_fkey
    FOREIGN KEY (note_id, workspace_id)
    REFERENCES public.user_note_v1(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT user_note_category_link_v1_category_workspace_fkey
    FOREIGN KEY (category_id, workspace_id)
    REFERENCES public.workspace_note_category_v1(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE public.user_note_tag_link_v1 (
  note_id integer NOT NULL,
  tag_id integer NOT NULL,
  workspace_id integer NOT NULL,
  CONSTRAINT user_note_tag_link_v1_pkey PRIMARY KEY (note_id, tag_id),
  CONSTRAINT user_note_tag_link_v1_note_workspace_fkey
    FOREIGN KEY (note_id, workspace_id)
    REFERENCES public.user_note_v1(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT user_note_tag_link_v1_tag_workspace_fkey
    FOREIGN KEY (tag_id, workspace_id)
    REFERENCES public.workspace_note_tag_v1(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX user_workspace_v1_user_id_idx ON public.user_workspace_v1(user_id);
CREATE INDEX workspace_note_category_v1_workspace_id_idx ON public.workspace_note_category_v1(workspace_id);
CREATE INDEX workspace_note_status_v1_workspace_id_position_idx ON public.workspace_note_status_v1(workspace_id, position, id);
CREATE INDEX workspace_note_tag_v1_workspace_id_idx ON public.workspace_note_tag_v1(workspace_id);
CREATE INDEX user_note_v1_workspace_id_idx ON public.user_note_v1(workspace_id);
CREATE INDEX user_note_v1_status_id_idx ON public.user_note_v1(status_id);
CREATE INDEX user_note_category_link_v1_category_id_idx ON public.user_note_category_link_v1(category_id);
CREATE INDEX user_note_tag_link_v1_tag_id_idx ON public.user_note_tag_link_v1(tag_id);
CREATE INDEX workspace_note_category_v1_category_embedding_hnsw_idx
  ON public.workspace_note_category_v1 USING hnsw (category_embedding public.vector_cosine_ops);
CREATE INDEX workspace_note_tag_v1_tag_embedding_hnsw_idx
  ON public.workspace_note_tag_v1 USING hnsw (tag_embedding public.vector_cosine_ops);
CREATE INDEX user_note_v1_description_embedding_hnsw_idx
  ON public.user_note_v1 USING hnsw (description_embedding public.vector_cosine_ops);

CREATE TRIGGER user_workspace_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_workspace_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
CREATE TRIGGER workspace_note_category_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.workspace_note_category_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
CREATE TRIGGER workspace_note_status_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.workspace_note_status_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
CREATE TRIGGER workspace_note_tag_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.workspace_note_tag_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();
CREATE TRIGGER user_note_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_note_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();

WITH seeded AS (
  INSERT INTO public.user_workspace_v1 (user_id, label)
  SELECT id, 'personal' FROM public.user_v1
  ON CONFLICT (user_id, label) DO UPDATE SET label = EXCLUDED.label
  RETURNING id
)
INSERT INTO public.workspace_note_category_v1 (workspace_id, label)
SELECT id, 'uncategorized' FROM seeded;

INSERT INTO public.workspace_note_status_v1 (workspace_id, label, position)
SELECT id, 'backlog', 0 FROM public.user_workspace_v1;

INSERT INTO public.workspace_note_tag_v1 (workspace_id, label)
SELECT id, 'important' FROM public.user_workspace_v1;
