CREATE TABLE public.user_workflow_status_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL,
    label text NOT NULL,
    sort_order integer NOT NULL,
    is_terminal boolean NOT NULL DEFAULT false,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_workflow_status_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,
    CONSTRAINT user_workflow_status_v1_user_id_label_key UNIQUE (user_id, label),
    CONSTRAINT user_workflow_status_v1_label_lowercase_check
      CHECK (label = lower(btrim(label)))
);

CREATE INDEX user_workflow_status_v1_user_id_idx
  ON public.user_workflow_status_v1 (user_id);

CREATE TRIGGER user_workflow_status_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_workflow_status_v1
FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();

ALTER TABLE public.user_note_v1
  ADD COLUMN workflow_status_id integer,
  ADD COLUMN time_completed timestamp with time zone;

ALTER TABLE public.user_note_v1
  ADD CONSTRAINT user_note_v1_workflow_status_id_fkey
    FOREIGN KEY (workflow_status_id) REFERENCES public.user_workflow_status_v1(id) ON DELETE RESTRICT;

CREATE INDEX user_note_v1_workflow_status_id_idx
  ON public.user_note_v1 (workflow_status_id)
  WHERE workflow_status_id IS NOT NULL;
