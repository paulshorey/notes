-- Give items and workspaces a permanent public identity.
--
-- The integer id stays the primary key and the target of every foreign key. The uid
-- is what leaves the database: URLs, backups, file routes, and anything a device
-- keeps. A client may choose the uid of an item it creates, so a create that is sent
-- twice stores one item.
--
-- The default fills existing rows as the column is added, one value per row.

ALTER TABLE public.workspace_item_v1
  ADD COLUMN uid uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT workspace_item_v1_uid_key UNIQUE (uid);

ALTER TABLE public.user_workspace_v1
  ADD COLUMN uid uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT user_workspace_v1_uid_key UNIQUE (uid);
