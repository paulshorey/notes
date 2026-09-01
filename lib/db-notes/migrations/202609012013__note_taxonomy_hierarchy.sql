-- Phase 1 (additive) of the Epic > Category > Group > Note hierarchy.
--
-- Adds two tables and moves notes onto groups, while leaving
-- user_note_category_v1 and user_note_v1.category_id in place so the currently
-- deployed app keeps working until the new code ships. Phase 2 drops them.
--
-- Ordering is load-bearing: the tier vocabulary must exist before any hierarchy
-- row, because user_taxonomy_v1 carries a composite FK into it.

-- ---------------------------------------------------------------------------
-- Tier vocabulary. Names the levels themselves, per user, so "Epic" can become
-- "Project" and "Note" can become "Task" without a schema change. Level 4 has
-- no rows in user_taxonomy_v1; it names the leaf content in user_note_v1.
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_taxonomy_level_v1 (
    user_id integer NOT NULL,
    level smallint NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT user_taxonomy_level_v1_pkey PRIMARY KEY (user_id, level),

    CONSTRAINT user_taxonomy_level_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,

    CONSTRAINT user_taxonomy_level_v1_level_check
      CHECK (level >= 1 AND level <= 4),

    -- Tier names are display chrome, so case is preserved; only blank is banned.
    CONSTRAINT user_taxonomy_level_v1_label_not_blank_check
      CHECK (label = btrim(label) AND label <> '')
);

-- Two tiers must not share a name, or the UI is ambiguous.
CREATE UNIQUE INDEX user_taxonomy_level_v1_user_id_label_lower_idx
  ON public.user_taxonomy_level_v1 (user_id, lower(label));

CREATE TRIGGER user_taxonomy_level_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_taxonomy_level_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();

INSERT INTO public.user_taxonomy_level_v1 (user_id, level, label)
SELECT u.id, v.level, v.label
FROM public.user_v1 u
CROSS JOIN (VALUES (1, 'Epic'), (2, 'Category'), (3, 'Group'), (4, 'Note'))
  AS v(level, label)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- The hierarchy itself. One self-referencing table; depth, parent level and
-- per-user ownership are all enforced declaratively, with no triggers.
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_taxonomy_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL,
    level smallint NOT NULL,
    parent_id integer,
    parent_level smallint GENERATED ALWAYS AS (level - 1) STORED,
    label text NOT NULL,
    label_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT user_taxonomy_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,

    -- Only container tiers live here; level 4 names the leaf content.
    CONSTRAINT user_taxonomy_v1_level_check
      CHECK (level >= 1 AND level <= 3),

    -- A row may only exist at a tier this user has a name for, and a tier
    -- definition cannot be dropped while rows still sit at it. This does not
    -- interfere with deleting a user: Postgres settles the whole cascade wave
    -- from one statement before evaluating the check.
    CONSTRAINT user_taxonomy_v1_level_fkey
      FOREIGN KEY (user_id, level)
      REFERENCES public.user_taxonomy_level_v1 (user_id, level)
      ON DELETE RESTRICT,

    CONSTRAINT user_taxonomy_v1_label_lowercase_check
      CHECK (label = lower(btrim(label))),

    -- Exactly the roots have no parent, and only roots may have none.
    CONSTRAINT user_taxonomy_v1_root_parent_check
      CHECK ((level = 1) = (parent_id IS NULL)),

    -- Target of the self-referencing composite FK below. user_id is part of the
    -- key so "parent must belong to the same user" is declarative too.
    CONSTRAINT user_taxonomy_v1_id_level_user_key
      UNIQUE (id, level, user_id),

    -- parent_level is always level - 1, so a row can only attach to a row
    -- exactly one tier up and owned by the same user.
    CONSTRAINT user_taxonomy_v1_parent_fkey
      FOREIGN KEY (parent_id, parent_level, user_id)
      REFERENCES public.user_taxonomy_v1 (id, level, user_id)
      ON DELETE RESTRICT,

    -- NULLS NOT DISTINCT (PG15+) so this also applies to level-1 rows.
    CONSTRAINT user_taxonomy_v1_sibling_label_key
      UNIQUE NULLS NOT DISTINCT (user_id, level, parent_id, label)
);

CREATE INDEX user_taxonomy_v1_user_id_level_idx
  ON public.user_taxonomy_v1 (user_id, level);

CREATE INDEX user_taxonomy_v1_parent_id_idx
  ON public.user_taxonomy_v1 (parent_id);

-- One partial HNSW index per level so level-scoped autocomplete never has to
-- post-filter a mixed-level index.
CREATE INDEX user_taxonomy_v1_epic_embedding_hnsw_idx
  ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops)
  WHERE level = 1;

CREATE INDEX user_taxonomy_v1_category_embedding_hnsw_idx
  ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops)
  WHERE level = 2;

CREATE INDEX user_taxonomy_v1_group_embedding_hnsw_idx
  ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops)
  WHERE level = 3;

CREATE TRIGGER user_taxonomy_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_taxonomy_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();

-- ---------------------------------------------------------------------------
-- Backfill. Every auto-created row is labelled 'uncategorized', matching the
-- existing flat-category default. Sibling-scoped uniqueness means an
-- 'uncategorized' epic, category and group coexist without conflict, including
-- for users who already own a category with that name.
-- ---------------------------------------------------------------------------

-- One epic per user, for every user — not only users who already have
-- categories. This is what makes the fallback chain always resolve.
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT u.id, 1, NULL, 'uncategorized'
FROM public.user_v1 u
ON CONFLICT DO NOTHING;

-- Every existing category becomes a level-2 row under that user's epic. The old
-- table's UNIQUE (user_id, label) makes this label join 1:1.
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT c.user_id, 2, e.id, c.label
FROM public.user_note_category_v1 c
JOIN public.user_taxonomy_v1 e
  ON e.user_id = c.user_id AND e.level = 1
ON CONFLICT DO NOTHING;

-- Backstop: an epic with no categories gets one, so users with zero categories
-- also end up with a complete chain.
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT e.user_id, 2, e.id, 'uncategorized'
FROM public.user_taxonomy_v1 e
WHERE e.level = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.user_taxonomy_v1 c
    WHERE c.parent_id = e.id AND c.level = 2
  )
ON CONFLICT DO NOTHING;

-- One group under every category, so existing notes have a home. Creating one
-- per category (rather than only where notes exist) is also what makes the
-- client's v1 -> v2 draft-snapshot upgrade a total mapping.
INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
SELECT c.user_id, 3, c.id, 'uncategorized'
FROM public.user_taxonomy_v1 c
WHERE c.level = 2
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Notes move from category to group. group_level is pinned to 3 so the
-- composite FK can only ever resolve to a level-3 row owned by the note's own
-- user, which replaces the application-side ownership check.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_note_v1
  ADD COLUMN group_id integer;

ALTER TABLE public.user_note_v1
  ADD COLUMN group_level smallint NOT NULL DEFAULT 3;

ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_level_check CHECK (group_level = 3);

UPDATE public.user_note_v1 n
SET group_id = g.id
FROM public.user_note_category_v1 oldcat
JOIN public.user_taxonomy_v1 c
  ON c.user_id = oldcat.user_id AND c.level = 2 AND c.label = oldcat.label
JOIN public.user_taxonomy_v1 g
  ON g.parent_id = c.id AND g.level = 3 AND g.label = 'uncategorized'
WHERE oldcat.id = n.category_id
  AND n.group_id IS NULL;

-- The safety net: a backfill that missed any note aborts the whole migration
-- rather than shipping a half-migrated table.
ALTER TABLE public.user_note_v1
  ALTER COLUMN group_id SET NOT NULL;

ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_group_id_fkey
    FOREIGN KEY (group_id, group_level, user_id)
    REFERENCES public.user_taxonomy_v1 (id, level, user_id)
    ON DELETE RESTRICT;

CREATE INDEX user_note_v1_group_id_idx
  ON public.user_note_v1 (group_id);
