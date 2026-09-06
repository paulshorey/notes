-- 202609061200__rename_default_taxonomy_labels.sql
-- Rename seeded default item labels without touching the schema.
--
--   epic:      uncategorized -> all
--   category:  stays uncategorized
--   group:     uncategorized -> ungrouped
--
-- Skip a row when a sibling already has the target label, so the unique
-- sibling-label constraint cannot fail on a user who already created "all"
-- or "ungrouped" by hand.

UPDATE public.user_taxonomy_v1 AS src
SET label = 'all'
WHERE src.level = 1
  AND src.label = 'uncategorized'
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_taxonomy_v1 AS sibling
    WHERE sibling.user_id = src.user_id
      AND sibling.level = 1
      AND sibling.parent_id IS NOT DISTINCT FROM src.parent_id
      AND sibling.id <> src.id
      AND sibling.label = 'all'
  );

UPDATE public.user_taxonomy_v1 AS src
SET label = 'ungrouped'
WHERE src.level = 3
  AND src.label = 'uncategorized'
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_taxonomy_v1 AS sibling
    WHERE sibling.user_id = src.user_id
      AND sibling.level = 3
      AND sibling.parent_id IS NOT DISTINCT FROM src.parent_id
      AND sibling.id <> src.id
      AND sibling.label = 'ungrouped'
  );
