-- Deploy the category-free runtime before this migration in each environment.
-- Older servers recreate this row during workspace bootstrap. See
-- docs/operations/category-cleanup.md for the required ordered rollout.
-- Category-link foreign keys cascade; note rows and other memberships survive.
DELETE FROM public.workspace_note_category_v1 WHERE label = 'uncategorized';

ALTER TABLE public.workspace_note_category_v1
  ADD CONSTRAINT workspace_note_category_v1_label_not_reserved_check
  CHECK (label <> 'uncategorized');
