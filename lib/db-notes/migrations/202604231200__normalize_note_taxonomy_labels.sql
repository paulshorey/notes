WITH category_mapping AS (
  SELECT
    id,
    user_id,
    lower(btrim(label)) AS normalized_label,
    min(id) OVER (PARTITION BY user_id, lower(btrim(label))) AS keep_id
  FROM public.user_note_category_v1
)
UPDATE public.user_note_v1 AS n
SET category_id = m.keep_id
FROM category_mapping AS m
WHERE n.category_id = m.id
  AND m.id <> m.keep_id;

DELETE FROM public.user_note_category_v1 AS c
USING (
  SELECT id
  FROM (
    SELECT
      id,
      min(id) OVER (PARTITION BY user_id, lower(btrim(label))) AS keep_id
    FROM public.user_note_category_v1
  ) AS mapping
  WHERE id <> keep_id
) AS duplicates
WHERE c.id = duplicates.id;

UPDATE public.user_note_category_v1
SET label = lower(btrim(label))
WHERE label IS DISTINCT FROM lower(btrim(label));

ALTER TABLE public.user_note_category_v1
  ADD CONSTRAINT user_note_category_v1_label_lowercase_check
  CHECK (label = lower(btrim(label)));

WITH tag_mapping AS (
  SELECT
    id,
    user_id,
    lower(btrim(label)) AS normalized_label,
    min(id) OVER (PARTITION BY user_id, lower(btrim(label))) AS keep_id
  FROM public.user_note_tag_v1
)
INSERT INTO public.user_note_tag_link_v1 (note_id, tag_id)
SELECT DISTINCT l.note_id, m.keep_id
FROM public.user_note_tag_link_v1 AS l
JOIN tag_mapping AS m
  ON m.id = l.tag_id
WHERE m.id <> m.keep_id
ON CONFLICT DO NOTHING;

DELETE FROM public.user_note_tag_link_v1 AS l
USING (
  SELECT id
  FROM (
    SELECT
      id,
      min(id) OVER (PARTITION BY user_id, lower(btrim(label))) AS keep_id
    FROM public.user_note_tag_v1
  ) AS mapping
  WHERE id <> keep_id
) AS duplicates
WHERE l.tag_id = duplicates.id;

DELETE FROM public.user_note_tag_v1 AS t
USING (
  SELECT id
  FROM (
    SELECT
      id,
      min(id) OVER (PARTITION BY user_id, lower(btrim(label))) AS keep_id
    FROM public.user_note_tag_v1
  ) AS mapping
  WHERE id <> keep_id
) AS duplicates
WHERE t.id = duplicates.id;

UPDATE public.user_note_tag_v1
SET label = lower(btrim(label))
WHERE label IS DISTINCT FROM lower(btrim(label));

ALTER TABLE public.user_note_tag_v1
  ADD CONSTRAINT user_note_tag_v1_label_lowercase_check
  CHECK (label = lower(btrim(label)));
