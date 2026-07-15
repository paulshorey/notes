ALTER TABLE public.user_v1
  ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_v1
  ADD CONSTRAINT user_v1_preferences_object_check
  CHECK (jsonb_typeof(preferences) = 'object');
