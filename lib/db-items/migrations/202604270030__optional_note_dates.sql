ALTER TABLE public.user_note_v1
  ALTER COLUMN time_due DROP NOT NULL,
  ALTER COLUMN time_remind DROP NOT NULL;
