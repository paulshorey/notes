-- One category and one subcategory per item.
--
-- A subcategory belongs to exactly one category. An item points at most at one
-- category and one subcategory, and the composite foreign keys guarantee the
-- subcategory belongs to the item's category and the category to its workspace.
-- Neither item foreign key takes a delete action: removing a category or
-- subcategory that still files items must clear or delete those items first.

CREATE TABLE public.workspace_subcategory_v1 (
  id serial PRIMARY KEY,
  category_id integer NOT NULL,
  label text NOT NULL,
  time_created timestamp with time zone DEFAULT now() NOT NULL,
  time_modified timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspace_subcategory_v1_label_normalized_check
    CHECK (label <> '' AND label = lower(btrim(label))),
  CONSTRAINT workspace_subcategory_v1_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.workspace_category_v1 (id) ON DELETE CASCADE,
  CONSTRAINT workspace_subcategory_v1_category_id_label_key UNIQUE (category_id, label),
  CONSTRAINT workspace_subcategory_v1_id_category_id_key UNIQUE (id, category_id)
);

CREATE TRIGGER workspace_subcategory_v1_apply_row_timestamps_v1
  BEFORE INSERT OR UPDATE ON public.workspace_subcategory_v1
  FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();

ALTER TABLE public.workspace_item_v1
  ADD COLUMN category_id integer,
  ADD COLUMN subcategory_id integer;

-- Filing an item is not an edit, so the backfill must not move time_modified.
ALTER TABLE public.workspace_item_v1
  DISABLE TRIGGER workspace_item_v1_apply_row_timestamps_v1;

-- An item in several categories keeps the oldest-created one.
UPDATE public.workspace_item_v1 n
SET category_id = kept.category_id
FROM (
  SELECT DISTINCT ON (l.item_id) l.item_id, l.category_id
  FROM public.item_category_link_v1 l
  JOIN public.workspace_category_v1 c ON c.id = l.category_id
  ORDER BY l.item_id, c.time_created, c.id
) kept
WHERE kept.item_id = n.id;

ALTER TABLE public.workspace_item_v1
  ENABLE TRIGGER workspace_item_v1_apply_row_timestamps_v1;

ALTER TABLE public.workspace_item_v1
  ADD CONSTRAINT workspace_item_v1_category_workspace_fkey
    FOREIGN KEY (category_id, workspace_id)
    REFERENCES public.workspace_category_v1 (id, workspace_id),
  ADD CONSTRAINT workspace_item_v1_subcategory_category_fkey
    FOREIGN KEY (subcategory_id, category_id)
    REFERENCES public.workspace_subcategory_v1 (id, category_id) ON UPDATE CASCADE,
  ADD CONSTRAINT workspace_item_v1_subcategory_requires_category_check
    CHECK (subcategory_id IS NULL OR category_id IS NOT NULL);

CREATE INDEX workspace_item_v1_category_id_idx
  ON public.workspace_item_v1 USING btree (category_id);
CREATE INDEX workspace_item_v1_subcategory_id_idx
  ON public.workspace_item_v1 USING btree (subcategory_id);
