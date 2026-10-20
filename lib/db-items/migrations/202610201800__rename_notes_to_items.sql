-- Rename the workspace-owned content domain without copying or rewriting rows.
-- The existing web client remains a text-focused view of these items.
DO $migration$
DECLARE
  names text[][] := ARRAY[
    ['user_note_v1', 'workspace_item_v1'],
    ['workspace_note_category_v1', 'workspace_category_v1'],
    ['workspace_note_status_v1', 'workspace_status_v1'],
    ['workspace_note_tag_v1', 'workspace_tag_v1'],
    ['user_note_category_link_v1', 'item_category_link_v1'],
    ['user_note_tag_link_v1', 'item_tag_link_v1']
  ];
  pair text[];
  affected_tables oid[];
  object record;
  renamed text;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY names LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME TO %I', pair[1], pair[2]);
  END LOOP;
  affected_tables := ARRAY[
    'public.workspace_item_v1'::regclass::oid,
    'public.workspace_category_v1'::regclass::oid,
    'public.workspace_status_v1'::regclass::oid,
    'public.workspace_tag_v1'::regclass::oid,
    'public.item_category_link_v1'::regclass::oid,
    'public.item_tag_link_v1'::regclass::oid
  ];

  ALTER TABLE public.item_category_link_v1 RENAME COLUMN note_id TO item_id;
  ALTER TABLE public.item_tag_link_v1 RENAME COLUMN note_id TO item_id;

  -- Constraints keep their identity and their referenced rows. Renaming a
  -- primary/unique constraint also renames its backing index in PostgreSQL.
  FOR object IN
    SELECT c.conname, c.conrelid::regclass AS relation
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='public' AND c.conrelid=ANY(affected_tables) AND c.conname LIKE '%note%'
  LOOP
    renamed := object.conname;
    FOREACH pair SLICE 1 IN ARRAY names LOOP
      renamed := replace(renamed, pair[1], pair[2]);
    END LOOP;
    renamed := replace(renamed, '_note_', '_item_');
    IF renamed <> object.conname THEN
      EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', object.relation, object.conname, renamed);
    END IF;
  END LOOP;

  FOR object IN
    SELECT c.relname AS indexname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid=ANY(affected_tables) AND c.relname LIKE '%note%'
  LOOP
    renamed := object.indexname;
    FOREACH pair SLICE 1 IN ARRAY names LOOP
      renamed := replace(renamed, pair[1], pair[2]);
    END LOOP;
    IF renamed <> object.indexname THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', object.indexname, renamed);
    END IF;
  END LOOP;

  FOR object IN
    SELECT t.tgname, t.tgrelid::regclass AS relation
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND t.tgrelid=ANY(affected_tables) AND NOT t.tgisinternal AND t.tgname LIKE '%note%'
  LOOP
    renamed := object.tgname;
    FOREACH pair SLICE 1 IN ARRAY names LOOP
      renamed := replace(renamed, pair[1], pair[2]);
    END LOOP;
    IF renamed <> object.tgname THEN
      EXECUTE format('ALTER TRIGGER %I ON %s RENAME TO %I', object.tgname, object.relation, renamed);
    END IF;
  END LOOP;

  ALTER SEQUENCE public.workspace_note_category_v1_id_seq RENAME TO workspace_category_v1_id_seq;
  ALTER SEQUENCE public.workspace_note_status_v1_id_seq RENAME TO workspace_status_v1_id_seq;
  ALTER SEQUENCE public.workspace_note_tag_v1_id_seq RENAME TO workspace_tag_v1_id_seq;
END
$migration$;

-- Rolling-deployment compatibility: old server builds can read AND write the
-- same physical rows through simple automatically-updatable views. No second
-- content store, ID allocator, or synchronization trigger is introduced.
CREATE VIEW public.user_note_v1 AS SELECT * FROM public.workspace_item_v1;
CREATE VIEW public.workspace_note_category_v1 AS SELECT * FROM public.workspace_category_v1;
CREATE VIEW public.workspace_note_status_v1 AS SELECT * FROM public.workspace_status_v1;
CREATE VIEW public.workspace_note_tag_v1 AS SELECT * FROM public.workspace_tag_v1;
CREATE VIEW public.user_note_category_link_v1 AS
  SELECT item_id AS note_id, category_id, workspace_id FROM public.item_category_link_v1;
CREATE VIEW public.user_note_tag_link_v1 AS
  SELECT item_id AS note_id, tag_id, workspace_id FROM public.item_tag_link_v1;

-- Keep user_note_v1_id_seq until old SQL writers have drained: the former
-- account-merge implementation calls nextval() with this literal name. New
-- code resolves the owning sequence with pg_get_serial_sequence() instead.
-- Both server generations therefore allocate IDs from ONE sequence.
