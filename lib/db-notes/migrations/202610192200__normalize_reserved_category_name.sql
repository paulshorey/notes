-- The original cleanup has already been applied in development: keep its
-- checksum intact and repair it with a forward migration. The same ordered
-- runtime rollout in docs/operations/category-cleanup.md still applies.
-- Match ECMAScript trim(): WhiteSpace + LineTerminator, including NBSP and BOM.
-- An explicit character set avoids locale-dependent POSIX whitespace classes.
DELETE FROM public.workspace_note_category_v1
WHERE lower(btrim(label, (chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)))) = 'uncategorized';

ALTER TABLE public.workspace_note_category_v1
  DROP CONSTRAINT workspace_note_category_v1_label_not_reserved_check,
  ADD CONSTRAINT workspace_note_category_v1_label_not_reserved_check
  CHECK (lower(btrim(label, (chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)))) <> 'uncategorized');
