ALTER TABLE public.user_v1
    ADD COLUMN credential_version integer DEFAULT 0 NOT NULL;

CREATE TABLE public.user_password_reset_v1 (
    request_id uuid PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.user_v1(id) ON DELETE CASCADE,
    credential_version integer NOT NULL,
    code_hash text,
    requested_at timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);
