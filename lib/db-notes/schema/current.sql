--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: apply_row_timestamps_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_row_timestamps_v1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.time_created := COALESCE(NEW.time_created, CURRENT_TIMESTAMP);
  ELSE
    NEW.time_created := OLD.time_created;
  END IF;

  NEW.time_modified := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: user_api_token_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_api_token_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_last_used timestamp with time zone
);


--
-- Name: user_api_token_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_api_token_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_api_token_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_note_category_link_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_category_link_v1 (
    note_id integer NOT NULL,
    category_id integer NOT NULL,
    workspace_id integer NOT NULL
);


--
-- Name: user_note_tag_link_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_tag_link_v1 (
    note_id integer NOT NULL,
    tag_id integer NOT NULL,
    workspace_id integer NOT NULL
);


--
-- Name: user_note_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_v1 (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    status_id integer,
    description text,
    time_due timestamp with time zone,
    time_remind timestamp with time zone,
    description_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    time_created timestamp with time zone DEFAULT now() NOT NULL,
    time_modified timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_note_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_note_v1_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_note_v1_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_note_v1_id_seq OWNED BY public.user_note_v1.id;


--
-- Name: user_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_v1 (
    id integer NOT NULL,
    username text NOT NULL,
    email text,
    phone text,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    password text,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT user_v1_preferences_object_check CHECK ((jsonb_typeof(preferences) = 'object'::text))
);


--
-- Name: user_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_workspace_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_workspace_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone DEFAULT now() NOT NULL,
    time_modified timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_workspace_v1_label_normalized_check CHECK (((label <> ''::text) AND (label = lower(btrim(label)))))
);


--
-- Name: user_workspace_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_workspace_v1_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_workspace_v1_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_workspace_v1_id_seq OWNED BY public.user_workspace_v1.id;


--
-- Name: workspace_note_category_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_note_category_v1 (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    label text NOT NULL,
    category_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    time_created timestamp with time zone DEFAULT now() NOT NULL,
    time_modified timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_note_category_v1_label_normalized_check CHECK (((label <> ''::text) AND (label = lower(btrim(label)))))
);


--
-- Name: workspace_note_category_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_note_category_v1_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_note_category_v1_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_note_category_v1_id_seq OWNED BY public.workspace_note_category_v1.id;


--
-- Name: workspace_note_status_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_note_status_v1 (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    label text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    time_created timestamp with time zone DEFAULT now() NOT NULL,
    time_modified timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_note_status_v1_label_normalized_check CHECK (((label <> ''::text) AND (label = lower(btrim(label))))),
    CONSTRAINT workspace_note_status_v1_position_check CHECK (("position" >= 0))
);


--
-- Name: workspace_note_status_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_note_status_v1_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_note_status_v1_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_note_status_v1_id_seq OWNED BY public.workspace_note_status_v1.id;


--
-- Name: workspace_note_tag_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_note_tag_v1 (
    id integer NOT NULL,
    workspace_id integer NOT NULL,
    label text NOT NULL,
    tag_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    time_created timestamp with time zone DEFAULT now() NOT NULL,
    time_modified timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_note_tag_v1_label_normalized_check CHECK (((label <> ''::text) AND (label = lower(btrim(label)))))
);


--
-- Name: workspace_note_tag_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_note_tag_v1_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_note_tag_v1_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_note_tag_v1_id_seq OWNED BY public.workspace_note_tag_v1.id;


--
-- Name: user_note_v1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1 ALTER COLUMN id SET DEFAULT nextval('public.user_note_v1_id_seq'::regclass);


--
-- Name: user_workspace_v1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_v1 ALTER COLUMN id SET DEFAULT nextval('public.user_workspace_v1_id_seq'::regclass);


--
-- Name: workspace_note_category_v1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_category_v1 ALTER COLUMN id SET DEFAULT nextval('public.workspace_note_category_v1_id_seq'::regclass);


--
-- Name: workspace_note_status_v1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_status_v1 ALTER COLUMN id SET DEFAULT nextval('public.workspace_note_status_v1_id_seq'::regclass);


--
-- Name: workspace_note_tag_v1 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_tag_v1 ALTER COLUMN id SET DEFAULT nextval('public.workspace_note_tag_v1_id_seq'::regclass);


--
-- Name: user_api_token_v1 user_api_token_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_token_v1
    ADD CONSTRAINT user_api_token_v1_pkey PRIMARY KEY (id);


--
-- Name: user_api_token_v1 user_api_token_v1_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_token_v1
    ADD CONSTRAINT user_api_token_v1_token_hash_key UNIQUE (token_hash);


--
-- Name: user_note_category_link_v1 user_note_category_link_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_category_link_v1
    ADD CONSTRAINT user_note_category_link_v1_pkey PRIMARY KEY (note_id, category_id);


--
-- Name: user_note_tag_link_v1 user_note_tag_link_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_link_v1
    ADD CONSTRAINT user_note_tag_link_v1_pkey PRIMARY KEY (note_id, tag_id);


--
-- Name: user_note_v1 user_note_v1_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: user_note_v1 user_note_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_pkey PRIMARY KEY (id);


--
-- Name: user_v1 user_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_v1
    ADD CONSTRAINT user_v1_pkey PRIMARY KEY (id);


--
-- Name: user_v1 user_v1_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_v1
    ADD CONSTRAINT user_v1_username_key UNIQUE (username);


--
-- Name: user_workspace_v1 user_workspace_v1_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_v1
    ADD CONSTRAINT user_workspace_v1_id_user_id_key UNIQUE (id, user_id);


--
-- Name: user_workspace_v1 user_workspace_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_v1
    ADD CONSTRAINT user_workspace_v1_pkey PRIMARY KEY (id);


--
-- Name: user_workspace_v1 user_workspace_v1_user_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_v1
    ADD CONSTRAINT user_workspace_v1_user_id_label_key UNIQUE (user_id, label);


--
-- Name: workspace_note_category_v1 workspace_note_category_v1_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_category_v1
    ADD CONSTRAINT workspace_note_category_v1_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: workspace_note_category_v1 workspace_note_category_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_category_v1
    ADD CONSTRAINT workspace_note_category_v1_pkey PRIMARY KEY (id);


--
-- Name: workspace_note_category_v1 workspace_note_category_v1_workspace_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_category_v1
    ADD CONSTRAINT workspace_note_category_v1_workspace_id_label_key UNIQUE (workspace_id, label);


--
-- Name: workspace_note_status_v1 workspace_note_status_v1_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_status_v1
    ADD CONSTRAINT workspace_note_status_v1_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: workspace_note_status_v1 workspace_note_status_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_status_v1
    ADD CONSTRAINT workspace_note_status_v1_pkey PRIMARY KEY (id);


--
-- Name: workspace_note_status_v1 workspace_note_status_v1_workspace_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_status_v1
    ADD CONSTRAINT workspace_note_status_v1_workspace_id_label_key UNIQUE (workspace_id, label);


--
-- Name: workspace_note_tag_v1 workspace_note_tag_v1_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_tag_v1
    ADD CONSTRAINT workspace_note_tag_v1_id_workspace_id_key UNIQUE (id, workspace_id);


--
-- Name: workspace_note_tag_v1 workspace_note_tag_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_tag_v1
    ADD CONSTRAINT workspace_note_tag_v1_pkey PRIMARY KEY (id);


--
-- Name: workspace_note_tag_v1 workspace_note_tag_v1_workspace_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_tag_v1
    ADD CONSTRAINT workspace_note_tag_v1_workspace_id_label_key UNIQUE (workspace_id, label);


--
-- Name: user_api_token_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_api_token_v1_user_id_idx ON public.user_api_token_v1 USING btree (user_id);


--
-- Name: user_note_category_link_v1_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_category_link_v1_category_id_idx ON public.user_note_category_link_v1 USING btree (category_id);


--
-- Name: user_note_tag_link_v1_tag_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_tag_link_v1_tag_id_idx ON public.user_note_tag_link_v1 USING btree (tag_id);


--
-- Name: user_note_v1_description_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_description_embedding_hnsw_idx ON public.user_note_v1 USING hnsw (description_embedding public.vector_cosine_ops);


--
-- Name: user_note_v1_status_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_status_id_idx ON public.user_note_v1 USING btree (status_id);


--
-- Name: user_note_v1_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_workspace_id_idx ON public.user_note_v1 USING btree (workspace_id);


--
-- Name: user_v1_is_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_v1_is_anonymous_idx ON public.user_v1 USING btree (is_anonymous) WHERE (is_anonymous = true);


--
-- Name: user_workspace_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_workspace_v1_user_id_idx ON public.user_workspace_v1 USING btree (user_id);


--
-- Name: workspace_note_category_v1_category_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_note_category_v1_category_embedding_hnsw_idx ON public.workspace_note_category_v1 USING hnsw (category_embedding public.vector_cosine_ops);


--
-- Name: workspace_note_category_v1_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_note_category_v1_workspace_id_idx ON public.workspace_note_category_v1 USING btree (workspace_id);


--
-- Name: workspace_note_status_v1_workspace_id_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_note_status_v1_workspace_id_position_idx ON public.workspace_note_status_v1 USING btree (workspace_id, "position", id);


--
-- Name: workspace_note_tag_v1_tag_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_note_tag_v1_tag_embedding_hnsw_idx ON public.workspace_note_tag_v1 USING hnsw (tag_embedding public.vector_cosine_ops);


--
-- Name: workspace_note_tag_v1_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_note_tag_v1_workspace_id_idx ON public.workspace_note_tag_v1 USING btree (workspace_id);


--
-- Name: user_note_v1 user_note_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_note_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_note_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_v1 user_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_workspace_v1 user_workspace_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_workspace_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_workspace_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: workspace_note_category_v1 workspace_note_category_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_note_category_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.workspace_note_category_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: workspace_note_status_v1 workspace_note_status_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_note_status_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.workspace_note_status_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: workspace_note_tag_v1 workspace_note_tag_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_note_tag_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.workspace_note_tag_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_api_token_v1 user_api_token_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_token_v1
    ADD CONSTRAINT user_api_token_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: user_note_category_link_v1 user_note_category_link_v1_category_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_category_link_v1
    ADD CONSTRAINT user_note_category_link_v1_category_workspace_fkey FOREIGN KEY (category_id, workspace_id) REFERENCES public.workspace_note_category_v1(id, workspace_id) ON DELETE CASCADE;


--
-- Name: user_note_category_link_v1 user_note_category_link_v1_note_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_category_link_v1
    ADD CONSTRAINT user_note_category_link_v1_note_workspace_fkey FOREIGN KEY (note_id, workspace_id) REFERENCES public.user_note_v1(id, workspace_id) ON DELETE CASCADE;


--
-- Name: user_note_tag_link_v1 user_note_tag_link_v1_note_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_link_v1
    ADD CONSTRAINT user_note_tag_link_v1_note_workspace_fkey FOREIGN KEY (note_id, workspace_id) REFERENCES public.user_note_v1(id, workspace_id) ON DELETE CASCADE;


--
-- Name: user_note_tag_link_v1 user_note_tag_link_v1_tag_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_link_v1
    ADD CONSTRAINT user_note_tag_link_v1_tag_workspace_fkey FOREIGN KEY (tag_id, workspace_id) REFERENCES public.workspace_note_tag_v1(id, workspace_id) ON DELETE CASCADE;


--
-- Name: user_note_v1 user_note_v1_status_workspace_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_status_workspace_fkey FOREIGN KEY (status_id, workspace_id) REFERENCES public.workspace_note_status_v1(id, workspace_id) ON DELETE RESTRICT;


--
-- Name: user_note_v1 user_note_v1_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE;


--
-- Name: user_workspace_v1 user_workspace_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_workspace_v1
    ADD CONSTRAINT user_workspace_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: workspace_note_category_v1 workspace_note_category_v1_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_category_v1
    ADD CONSTRAINT workspace_note_category_v1_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE;


--
-- Name: workspace_note_status_v1 workspace_note_status_v1_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_status_v1
    ADD CONSTRAINT workspace_note_status_v1_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE;


--
-- Name: workspace_note_tag_v1 workspace_note_tag_v1_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_note_tag_v1
    ADD CONSTRAINT workspace_note_tag_v1_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.user_workspace_v1(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


