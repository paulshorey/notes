ALTER TABLE public.user_note_category_v1
  RENAME TO user_note_tag_v1;

ALTER TABLE public.user_note_category_link_v1
  RENAME TO user_note_tag_link_v1;

ALTER TABLE public.user_note_tag_link_v1
  RENAME COLUMN category_id TO tag_id;

ALTER TABLE public.user_note_tag_v1
  RENAME COLUMN category_embedding TO tag_embedding;

ALTER TABLE public.user_note_category_v1_id_seq
  RENAME TO user_note_tag_v1_id_seq;

ALTER TABLE public.user_note_tag_link_v1
  RENAME CONSTRAINT user_note_category_link_v1_pkey TO user_note_tag_link_v1_pkey;

ALTER TABLE public.user_note_tag_link_v1
  RENAME CONSTRAINT user_note_category_link_v1_note_id_fkey TO user_note_tag_link_v1_note_id_fkey;

ALTER TABLE public.user_note_tag_link_v1
  RENAME CONSTRAINT user_note_category_link_v1_category_id_fkey TO user_note_tag_link_v1_tag_id_fkey;

ALTER TABLE public.user_note_tag_v1
  RENAME CONSTRAINT user_note_category_v1_pkey TO user_note_tag_v1_pkey;

ALTER TABLE public.user_note_tag_v1
  RENAME CONSTRAINT user_note_category_v1_user_id_fkey TO user_note_tag_v1_user_id_fkey;

ALTER TABLE public.user_note_tag_v1
  RENAME CONSTRAINT user_note_category_v1_user_id_label_key TO user_note_tag_v1_user_id_label_key;

ALTER INDEX public.user_note_category_link_v1_category_id_idx
  RENAME TO user_note_tag_link_v1_tag_id_idx;

ALTER INDEX public.user_note_category_v1_category_embedding_hnsw_idx
  RENAME TO user_note_tag_v1_tag_embedding_hnsw_idx;

ALTER INDEX public.user_note_category_v1_user_id_idx
  RENAME TO user_note_tag_v1_user_id_idx;

ALTER TRIGGER user_note_category_v1_apply_row_timestamps_v1
  ON public.user_note_tag_v1
  RENAME TO user_note_tag_v1_apply_row_timestamps_v1;
