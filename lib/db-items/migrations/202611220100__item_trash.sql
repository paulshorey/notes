-- Trash for deleted items.
--
-- A deleted item leaves workspace_item_v1 and is kept here in its portable form: the
-- fields of a backup item, with vocabulary by label. Nothing that reads items has to
-- know about trash, and a restore is an import of that one item.
--
-- The trash belongs to the user, because deleting a workspace's last item removes the
-- workspace and the vocabulary nothing else uses. An entry remembers the workspace by
-- id while it exists and by label after that.

CREATE TABLE public.user_item_trash_v1 (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.user_v1(id) ON DELETE CASCADE,
    workspace_id integer REFERENCES public.user_workspace_v1(id) ON DELETE SET NULL,
    workspace_label text NOT NULL,
    item jsonb NOT NULL,
    time_deleted timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT user_item_trash_v1_item_object_check CHECK (jsonb_typeof(item) = 'object')
);

CREATE INDEX user_item_trash_v1_user_id_time_deleted_idx
    ON public.user_item_trash_v1 (user_id, time_deleted DESC, id DESC);

CREATE INDEX user_item_trash_v1_workspace_id_idx
    ON public.user_item_trash_v1 (workspace_id);
