-- Phase 2 (cutover) of the Epic > Category > Group > Note hierarchy.
--
-- Phase 1 left user_note_category_v1 and user_note_v1.category_id in place so
-- the previously deployed app could keep reading during the rollback window.
-- The new code has been live since PR #70 and writes group_id alone, so both
-- leftovers are unused. Dropping them is the cutover; it is not reversible
-- without restoring a backup.

ALTER TABLE public.user_note_v1
  DROP CONSTRAINT IF EXISTS user_note_v1_category_id_fkey;

DROP INDEX IF EXISTS public.user_note_v1_category_id_idx;

ALTER TABLE public.user_note_v1
  DROP COLUMN category_id;

DROP TABLE public.user_note_category_v1;
