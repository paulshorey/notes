-- Journal entries: a third kind of content.
--
-- A journal entry is an item that belongs to a calendar day. The day is a plain date,
-- with no time or zone, and a workspace has one entry per day. An entry needs no text.

ALTER TABLE public.workspace_item_v1
    ADD COLUMN entry_date date;

CREATE UNIQUE INDEX workspace_item_v1_journal_day_key
    ON public.workspace_item_v1 (workspace_id, entry_date)
    WHERE entry_date IS NOT NULL;

ALTER TABLE public.workspace_item_v1
    DROP CONSTRAINT workspace_item_v1_content_check,
    ADD CONSTRAINT workspace_item_v1_content_check
        CHECK (
            COALESCE(description, '') ~ '[^\t\n\v\f\r    -     　﻿]'
            OR time_start IS NOT NULL
            OR entry_date IS NOT NULL
        );
