-- A time block is its start and its end. Whether it lies in the past or the future is
-- read from those two, so no column says it.

ALTER TABLE public.workspace_item_v1
    DROP CONSTRAINT workspace_item_v1_time_planned_requires_block_check,
    DROP COLUMN time_planned;
