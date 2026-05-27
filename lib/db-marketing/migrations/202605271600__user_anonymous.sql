ALTER TABLE public.user_v1
  ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false;

CREATE INDEX user_v1_is_anonymous_idx
  ON public.user_v1 (is_anonymous)
  WHERE is_anonymous = true;
