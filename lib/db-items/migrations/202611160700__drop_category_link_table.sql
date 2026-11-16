-- An item is filed through workspace_item_v1.category_id. The link table that held
-- several categories per item, and the view that exposed it under its earlier name,
-- are no longer read or written by any running release.

DROP VIEW public.user_note_category_link_v1;
DROP TABLE public.item_category_link_v1;
