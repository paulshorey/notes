CREATE TABLE public.user_api_token_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_last_used timestamp with time zone,
    CONSTRAINT user_api_token_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE,
    CONSTRAINT user_api_token_v1_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX user_api_token_v1_user_id_idx
  ON public.user_api_token_v1 (user_id);
