INSERT INTO public.user_note_tag_v1 (user_id, label)
SELECT u.id, 'important'
FROM public.user_v1 u
ON CONFLICT (user_id, label) DO NOTHING;
