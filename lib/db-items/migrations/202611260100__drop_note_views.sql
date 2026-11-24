-- The note-named views over the item tables have no reader or writer: every query
-- names the item tables.
DROP VIEW IF EXISTS public.user_note_tag_link_v1;
DROP VIEW IF EXISTS public.user_note_v1;
DROP VIEW IF EXISTS public.workspace_note_category_v1;
DROP VIEW IF EXISTS public.workspace_note_status_v1;
DROP VIEW IF EXISTS public.workspace_note_tag_v1;
