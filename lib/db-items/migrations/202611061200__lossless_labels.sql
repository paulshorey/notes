-- Labels keep the casing the user typed. Uniqueness and lookups use a generated
-- label_key (Unicode NFKC, lowercased), so "NYC" and "nyc" are the same label.
-- The key lowercases with the ICU root collation so it does not depend on the
-- database locale and matches ECMAScript String.prototype.toLowerCase().
-- Labels are still stored without surrounding whitespace, using the ECMAScript
-- trim() character set that the reserved-category check already uses.

CREATE FUNCTION public.app_label_whitespace_v1() RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);

CREATE FUNCTION public.app_label_key_v1(label text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN lower(normalize(label, NFKC) COLLATE "und-x-icu");

-- As in the earlier reserved-name cleanups, a category spelled as a compatibility
-- form of the reserved name (for example full-width) is removed; its items keep
-- their content and appear in the computed uncategorized group.
DELETE FROM public.workspace_category_v1
  WHERE public.app_label_key_v1(btrim(label, public.app_label_whitespace_v1())) = 'uncategorized';

-- Existing labels were lowercased and trimmed of ASCII spaces only. Trim the
-- remaining ECMAScript whitespace, then require that no two labels share a key.
-- Fail the deploy rather than guess a merge.
DO $$
DECLARE
  problems int;
BEGIN
  SELECT
    (SELECT count(*) FROM (SELECT 1 FROM public.user_workspace_v1 GROUP BY user_id, public.app_label_key_v1(btrim(label, public.app_label_whitespace_v1())) HAVING count(*) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.workspace_category_v1 GROUP BY workspace_id, public.app_label_key_v1(btrim(label, public.app_label_whitespace_v1())) HAVING count(*) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.workspace_status_v1 GROUP BY workspace_id, public.app_label_key_v1(btrim(label, public.app_label_whitespace_v1())) HAVING count(*) > 1) d)
    + (SELECT count(*) FROM (SELECT 1 FROM public.workspace_tag_v1 GROUP BY workspace_id, public.app_label_key_v1(btrim(label, public.app_label_whitespace_v1())) HAVING count(*) > 1) d)
    + (SELECT count(*) FROM public.user_workspace_v1 WHERE btrim(label, public.app_label_whitespace_v1()) = '')
    + (SELECT count(*) FROM public.workspace_category_v1 WHERE btrim(label, public.app_label_whitespace_v1()) = '')
    + (SELECT count(*) FROM public.workspace_status_v1 WHERE btrim(label, public.app_label_whitespace_v1()) = '')
    + (SELECT count(*) FROM public.workspace_tag_v1 WHERE btrim(label, public.app_label_whitespace_v1()) = '')
  INTO problems;
  IF problems > 0 THEN
    RAISE EXCEPTION 'lossless_labels: % label(s) are blank or collide after trimming and NFKC normalization; resolve them before migrating', problems;
  END IF;
END $$;

UPDATE public.user_workspace_v1 SET label = btrim(label, public.app_label_whitespace_v1())
  WHERE label <> btrim(label, public.app_label_whitespace_v1());
UPDATE public.workspace_category_v1 SET label = btrim(label, public.app_label_whitespace_v1())
  WHERE label <> btrim(label, public.app_label_whitespace_v1());
UPDATE public.workspace_status_v1 SET label = btrim(label, public.app_label_whitespace_v1())
  WHERE label <> btrim(label, public.app_label_whitespace_v1());
UPDATE public.workspace_tag_v1 SET label = btrim(label, public.app_label_whitespace_v1())
  WHERE label <> btrim(label, public.app_label_whitespace_v1());

ALTER TABLE public.user_workspace_v1
  DROP CONSTRAINT user_workspace_v1_label_normalized_check,
  ADD CONSTRAINT user_workspace_v1_label_trimmed_check
    CHECK (label <> '' AND label = btrim(label, public.app_label_whitespace_v1())),
  ADD COLUMN label_key text GENERATED ALWAYS AS (public.app_label_key_v1(label)) STORED;
CREATE UNIQUE INDEX user_workspace_v1_user_id_label_key_idx
  ON public.user_workspace_v1 (user_id, label_key);

ALTER TABLE public.workspace_category_v1
  DROP CONSTRAINT workspace_category_v1_label_normalized_check,
  ADD CONSTRAINT workspace_category_v1_label_trimmed_check
    CHECK (label <> '' AND label = btrim(label, public.app_label_whitespace_v1())),
  ADD COLUMN label_key text GENERATED ALWAYS AS (public.app_label_key_v1(label)) STORED;
CREATE UNIQUE INDEX workspace_category_v1_workspace_id_label_key_idx
  ON public.workspace_category_v1 (workspace_id, label_key);

ALTER TABLE public.workspace_status_v1
  DROP CONSTRAINT workspace_status_v1_label_normalized_check,
  ADD CONSTRAINT workspace_status_v1_label_trimmed_check
    CHECK (label <> '' AND label = btrim(label, public.app_label_whitespace_v1())),
  ADD COLUMN label_key text GENERATED ALWAYS AS (public.app_label_key_v1(label)) STORED;
CREATE UNIQUE INDEX workspace_status_v1_workspace_id_label_key_idx
  ON public.workspace_status_v1 (workspace_id, label_key);

ALTER TABLE public.workspace_tag_v1
  DROP CONSTRAINT workspace_tag_v1_label_normalized_check,
  ADD CONSTRAINT workspace_tag_v1_label_trimmed_check
    CHECK (label <> '' AND label = btrim(label, public.app_label_whitespace_v1())),
  ADD COLUMN label_key text GENERATED ALWAYS AS (public.app_label_key_v1(label)) STORED;
CREATE UNIQUE INDEX workspace_tag_v1_workspace_id_label_key_idx
  ON public.workspace_tag_v1 (workspace_id, label_key);

-- The reserved display label is rejected in any casing or compatibility form.
ALTER TABLE public.workspace_category_v1
  DROP CONSTRAINT workspace_category_v1_label_not_reserved_check,
  ADD CONSTRAINT workspace_category_v1_label_not_reserved_check
    CHECK (public.app_label_key_v1(btrim(label, public.app_label_whitespace_v1())) <> 'uncategorized');

-- Rollout compatibility. Previous-release servers read, export, and validate
-- labels as lowercase, and use ON CONFLICT (…, label). Until they have drained,
-- every write stores labels lowercased, and the exact-label unique constraints
-- stay as their conflict targets (label_key uniqueness implies them). A later
-- migration drops the lowercasing triggers, after which labels keep their casing.
-- Lowercasing must not change the label's key (lowercase and NFKC do not always
-- commute, for example U+03F9), so the key itself is stored when it is a valid
-- label, and a label with neither form is rejected. `contracts/label.ts` mirrors
-- this as rolloutLabelSpelling.
CREATE FUNCTION public.app_label_lowercase_v1() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  key text := public.app_label_key_v1(NEW.label);
  lowered text := lower(NEW.label COLLATE "und-x-icu");
BEGIN
  IF public.app_label_key_v1(lowered) = key THEN
    NEW.label := lowered;
  ELSIF key <> '' AND key = btrim(key, public.app_label_whitespace_v1()) THEN
    NEW.label := key;
  ELSE
    -- No lowercase spelling keeps this label's identity (for example U+00A8 followed
    -- by U+03F9), so previous-release servers could not read it. Reject it until
    -- labels keep their casing.
    RAISE EXCEPTION 'This label cannot be saved yet. Remove unusual symbols and try again.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_workspace_v1_label_lowercase_v1
  BEFORE INSERT OR UPDATE OF label ON public.user_workspace_v1
  FOR EACH ROW EXECUTE FUNCTION public.app_label_lowercase_v1();
CREATE TRIGGER workspace_category_v1_label_lowercase_v1
  BEFORE INSERT OR UPDATE OF label ON public.workspace_category_v1
  FOR EACH ROW EXECUTE FUNCTION public.app_label_lowercase_v1();
CREATE TRIGGER workspace_status_v1_label_lowercase_v1
  BEFORE INSERT OR UPDATE OF label ON public.workspace_status_v1
  FOR EACH ROW EXECUTE FUNCTION public.app_label_lowercase_v1();
CREATE TRIGGER workspace_tag_v1_label_lowercase_v1
  BEFORE INSERT OR UPDATE OF label ON public.workspace_tag_v1
  FOR EACH ROW EXECUTE FUNCTION public.app_label_lowercase_v1();

-- Labels that differ only by compatibility form (for example full-width) share a
-- key. A previous-release server inserting such a variant of an existing label
-- fails on the key index and rolls back its transaction; no partial write or
-- silent remapping happens.
