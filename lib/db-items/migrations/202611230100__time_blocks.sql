-- Time blocks: a second kind of content.
--
-- A time block is a start and an end on an item. Both are set or neither is, and they
-- may be the same instant. `time_planned` marks a block as a plan not yet confirmed.
--
-- With two kinds of content the rules about content become constraints: an item holds
-- text or a time block, and a status belongs to an item with text. Text counts when it
-- has a character that is not whitespace, listed as in the item service so the rule
-- does not depend on the database's collation.

ALTER TABLE public.workspace_item_v1
    ADD COLUMN time_start timestamptz,
    ADD COLUMN time_end timestamptz,
    ADD COLUMN time_planned boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT workspace_item_v1_time_block_complete_check
        CHECK ((time_start IS NULL) = (time_end IS NULL)),
    ADD CONSTRAINT workspace_item_v1_time_block_order_check
        CHECK (time_end >= time_start),
    ADD CONSTRAINT workspace_item_v1_time_planned_requires_block_check
        CHECK (NOT time_planned OR time_start IS NOT NULL);

-- Items that hold no content were refused by the item service and have no view. Any
-- left by earlier versions are removed so the constraint can be added.
DELETE FROM public.workspace_item_v1
WHERE COALESCE(description, '') !~ '[^\t\n\v\f\r    -     　﻿]';

ALTER TABLE public.workspace_item_v1
    ADD CONSTRAINT workspace_item_v1_content_check
        CHECK (
            COALESCE(description, '') ~ '[^\t\n\v\f\r    -     　﻿]'
            OR time_start IS NOT NULL
        ),
    ADD CONSTRAINT workspace_item_v1_status_requires_text_check
        CHECK (
            status_id IS NULL
            OR COALESCE(description, '') ~ '[^\t\n\v\f\r    -     　﻿]'
        );

CREATE INDEX workspace_item_v1_workspace_id_time_start_idx
    ON public.workspace_item_v1 (workspace_id, time_start)
    WHERE time_start IS NOT NULL;
