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
-- Name: user_note_category_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_category_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    category_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    CONSTRAINT user_note_category_v1_label_lowercase_check CHECK ((label = lower(btrim(label))))
);


--
-- Name: user_note_category_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_note_category_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_note_category_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_note_tag_link_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_tag_link_v1 (
    note_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: user_note_tag_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_tag_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tag_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    CONSTRAINT user_note_tag_v1_label_lowercase_check CHECK ((label = lower(btrim(label))))
);


--
-- Name: user_note_tag_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_note_tag_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_note_tag_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_note_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    description text,
    time_due timestamp with time zone,
    time_remind timestamp with time zone,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    description_embedding public.vector(1024),
    category_id integer,
    group_id integer NOT NULL,
    group_level smallint DEFAULT 3 NOT NULL,
    CONSTRAINT user_note_v1_group_level_check CHECK ((group_level = 3))
);


--
-- Name: user_note_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_note_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_note_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_taxonomy_level_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_taxonomy_level_v1 (
    user_id integer NOT NULL,
    level smallint NOT NULL,
    label text NOT NULL,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_taxonomy_level_v1_label_not_blank_check CHECK (((label = btrim(label)) AND (label <> ''::text))),
    CONSTRAINT user_taxonomy_level_v1_level_check CHECK (((level >= 1) AND (level <= 4)))
);


--
-- Name: user_taxonomy_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_taxonomy_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    level smallint NOT NULL,
    parent_id integer,
    parent_level smallint GENERATED ALWAYS AS ((level - 1)) STORED,
    label text NOT NULL,
    label_embedding public.vector(1024),
    embedding_model text,
    embedding_updated_at timestamp with time zone,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_taxonomy_v1_label_lowercase_check CHECK ((label = lower(btrim(label)))),
    CONSTRAINT user_taxonomy_v1_level_check CHECK (((level >= 1) AND (level <= 3))),
    CONSTRAINT user_taxonomy_v1_root_parent_check CHECK (((level = 1) = (parent_id IS NULL)))
);


--
-- Name: user_taxonomy_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_taxonomy_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_taxonomy_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


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
-- Name: user_note_category_v1 user_note_category_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_category_v1
    ADD CONSTRAINT user_note_category_v1_pkey PRIMARY KEY (id);


--
-- Name: user_note_category_v1 user_note_category_v1_user_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_category_v1
    ADD CONSTRAINT user_note_category_v1_user_id_label_key UNIQUE (user_id, label);


--
-- Name: user_note_tag_link_v1 user_note_tag_link_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_link_v1
    ADD CONSTRAINT user_note_tag_link_v1_pkey PRIMARY KEY (note_id, tag_id);


--
-- Name: user_note_tag_v1 user_note_tag_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_v1
    ADD CONSTRAINT user_note_tag_v1_pkey PRIMARY KEY (id);


--
-- Name: user_note_tag_v1 user_note_tag_v1_user_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_v1
    ADD CONSTRAINT user_note_tag_v1_user_id_label_key UNIQUE (user_id, label);


--
-- Name: user_note_v1 user_note_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_pkey PRIMARY KEY (id);


--
-- Name: user_taxonomy_level_v1 user_taxonomy_level_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_level_v1
    ADD CONSTRAINT user_taxonomy_level_v1_pkey PRIMARY KEY (user_id, level);


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_id_level_user_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_v1
    ADD CONSTRAINT user_taxonomy_v1_id_level_user_key UNIQUE (id, level, user_id);


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_v1
    ADD CONSTRAINT user_taxonomy_v1_pkey PRIMARY KEY (id);


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_sibling_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_v1
    ADD CONSTRAINT user_taxonomy_v1_sibling_label_key UNIQUE NULLS NOT DISTINCT (user_id, level, parent_id, label);


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
-- Name: user_api_token_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_api_token_v1_user_id_idx ON public.user_api_token_v1 USING btree (user_id);


--
-- Name: user_note_category_v1_category_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_category_v1_category_embedding_hnsw_idx ON public.user_note_category_v1 USING hnsw (category_embedding public.vector_cosine_ops);


--
-- Name: user_note_category_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_category_v1_user_id_idx ON public.user_note_category_v1 USING btree (user_id);


--
-- Name: user_note_tag_link_v1_tag_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_tag_link_v1_tag_id_idx ON public.user_note_tag_link_v1 USING btree (tag_id);


--
-- Name: user_note_tag_v1_tag_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_tag_v1_tag_embedding_hnsw_idx ON public.user_note_tag_v1 USING hnsw (tag_embedding public.vector_cosine_ops);


--
-- Name: user_note_tag_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_tag_v1_user_id_idx ON public.user_note_tag_v1 USING btree (user_id);


--
-- Name: user_note_v1_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_category_id_idx ON public.user_note_v1 USING btree (category_id);


--
-- Name: user_note_v1_description_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_description_embedding_hnsw_idx ON public.user_note_v1 USING hnsw (description_embedding public.vector_cosine_ops);


--
-- Name: user_note_v1_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_group_id_idx ON public.user_note_v1 USING btree (group_id);


--
-- Name: user_note_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_user_id_idx ON public.user_note_v1 USING btree (user_id);


--
-- Name: user_taxonomy_level_v1_user_id_label_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_taxonomy_level_v1_user_id_label_lower_idx ON public.user_taxonomy_level_v1 USING btree (user_id, lower(label));


--
-- Name: user_taxonomy_v1_category_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taxonomy_v1_category_embedding_hnsw_idx ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops) WHERE (level = 2);


--
-- Name: user_taxonomy_v1_epic_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taxonomy_v1_epic_embedding_hnsw_idx ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops) WHERE (level = 1);


--
-- Name: user_taxonomy_v1_group_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taxonomy_v1_group_embedding_hnsw_idx ON public.user_taxonomy_v1 USING hnsw (label_embedding public.vector_cosine_ops) WHERE (level = 3);


--
-- Name: user_taxonomy_v1_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taxonomy_v1_parent_id_idx ON public.user_taxonomy_v1 USING btree (parent_id);


--
-- Name: user_taxonomy_v1_user_id_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_taxonomy_v1_user_id_level_idx ON public.user_taxonomy_v1 USING btree (user_id, level);


--
-- Name: user_v1_is_anonymous_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_v1_is_anonymous_idx ON public.user_v1 USING btree (is_anonymous) WHERE (is_anonymous = true);


--
-- Name: user_note_category_v1 user_note_category_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_note_category_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_note_category_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_note_tag_v1 user_note_tag_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_note_tag_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_note_tag_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_note_v1 user_note_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_note_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_note_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_taxonomy_level_v1 user_taxonomy_level_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_taxonomy_level_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_taxonomy_level_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_taxonomy_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_taxonomy_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_v1 user_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_api_token_v1 user_api_token_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_token_v1
    ADD CONSTRAINT user_api_token_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: user_note_category_v1 user_note_category_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_category_v1
    ADD CONSTRAINT user_note_category_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: user_note_tag_link_v1 user_note_tag_link_v1_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_link_v1
    ADD CONSTRAINT user_note_tag_link_v1_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.user_note_v1(id) ON DELETE CASCADE;


--
-- Name: user_note_tag_link_v1 user_note_tag_link_v1_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_link_v1
    ADD CONSTRAINT user_note_tag_link_v1_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.user_note_tag_v1(id) ON DELETE CASCADE;


--
-- Name: user_note_tag_v1 user_note_tag_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_tag_v1
    ADD CONSTRAINT user_note_tag_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: user_note_v1 user_note_v1_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.user_note_category_v1(id) ON DELETE RESTRICT;


--
-- Name: user_note_v1 user_note_v1_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_group_id_fkey FOREIGN KEY (group_id, group_level, user_id) REFERENCES public.user_taxonomy_v1(id, level, user_id) ON DELETE RESTRICT;


--
-- Name: user_note_v1 user_note_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: user_taxonomy_level_v1 user_taxonomy_level_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_level_v1
    ADD CONSTRAINT user_taxonomy_level_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_level_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_v1
    ADD CONSTRAINT user_taxonomy_v1_level_fkey FOREIGN KEY (user_id, level) REFERENCES public.user_taxonomy_level_v1(user_id, level) ON DELETE RESTRICT;


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_parent_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_v1
    ADD CONSTRAINT user_taxonomy_v1_parent_fkey FOREIGN KEY (parent_id, parent_level, user_id) REFERENCES public.user_taxonomy_v1(id, level, user_id) ON DELETE RESTRICT;


--
-- Name: user_taxonomy_v1 user_taxonomy_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_taxonomy_v1
    ADD CONSTRAINT user_taxonomy_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


