# Plan: item content types and relations

This plan extends the item model so one record can be a note, a task, a checklist, a
time block, or a journal entry, and so items can relate to each other. It builds on
[item core](../db/item-core.md) and [item taxonomy](../db/item-taxonomy.md). Each phase
updates those documents when it ships. Built so far, from phase 1: the content
and state split, with text as the only content; the trash; and view selection rules
with the notes filter; and the conflict check on update.

The structure is the commitment. The detailed rules for what happens when a property is
removed are added rule by rule as each type is built and tested.

## Principles

- **One record, many views.** An item is never converted between types. A view only
  presents items; an edit made in one view is the same edit everywhere.
- **No stored type.** A kind is computed from what the item holds.
- **Everything stays inside one workspace.** A parent, a link, a category, a status,
  and a tag always belong to the item's workspace, enforced by composite foreign keys.
- **Declared once.** Every new column or table is declared in
  `sql/item/stored-capabilities.ts`, so backup, restore, duplicate detection, and
  account merge carry it and `db:verify` fails when one is missed.

## Content and state

What an item holds is split into two groups.

| Group   | Members                                                          | Rule                                     |
| ------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Content | text, time block, journal date                                   | An item holds at least one.              |
| State   | status, done, due date, reminder, parent, position, filing, tags | Describes an item; never keeps it alive. |

Two rules follow:

- An item without content is not kept.
- A status and a parent each require text.

The item service enforces them. Check constraints join it in phase 2, with the second
content type. While text is the only content, a constraint could only say that text is
required, and the layers below the service stay free of that assumption so that a time
block without text needs no change there.

A date alone does not make an item. A location is a later state field that turns a
dated item into an event.

Production and development hold no item without text (checked 2026-11-21), so the
constraints will need no data migration.

## Kinds and views

| Kind      | An item is this kind when it holds | View                       |
| --------- | ---------------------------------- | -------------------------- |
| `note`    | text                               | notes                      |
| `task`    | text and a status                  | tasks: board and list      |
| `list`    | children                           | lists: nested checklist    |
| `time`    | a time block                       | time: day timeline         |
| `journal` | a journal date                     | journal: one entry per day |

Each kind has its own screen. A calendar view is a sixth screen that lists every item
with any date; it is a view, not a kind.

A view declares its own selection rule instead of being bound to exactly one kind. The
notes view lists every item with text and has a filter per kind. Journal entries, time
blocks, and tasks are shown by default; list lines are hidden by default. The choice is
a user preference.

Because every item holds content and each content type has a view that lists it, no
item can become invisible.

## Storage

New columns on `workspace_item_v1`:

| Column           | Type        | Purpose                                                  |
| ---------------- | ----------- | -------------------------------------------------------- |
| `author_user_id` | integer     | Who created the item; needed once a workspace is shared. |
| `time_done`      | timestamptz | When the item was completed; null while open.            |
| `position`       | text        | Fractional order key.                                    |
| `parent_id`      | integer     | The item that contains this one.                         |
| `time_start`     | timestamptz | Start of a time block.                                   |
| `time_end`       | timestamptz | End of a time block; null while a timer runs.            |
| `time_planned`   | boolean     | A plan not yet confirmed, as opposed to a record.        |
| `entry_date`     | date        | The calendar day of a journal entry.                     |

`workspace_status_v1` gains `is_done`, so a status can mean completed.

An update names the `time_modified` of the version it edited, and is refused when the
stored item has changed since ([item core](../db/item-core.md#concurrent-edits)). The
modification time is the version, so no revision column is needed.

Deleted items leave the item table for `user_item_trash_v1`, which keeps each as its
backup fields ([item core](../db/item-core.md#trash)). No query over items has to
exclude trashed rows, a unique rule such as one journal entry per day needs no
exception for them, and a trashed list is stored as its lines together.

New table `item_link_v1`: `from_item_id`, `to_item_id`, `workspace_id`, `relation`,
`position`. Both item keys are composite with `workspace_id`.

Scalar fields that an item holds once stay as columns. Anything an item holds many of
gets its own table keyed by item id. There is no generic JSON content column, because it
would bypass constraints, typed backup fields, and the storage audit.

## Relations

| Relation    | Meaning                | Shape                      | Stored as               |
| ----------- | ---------------------- | -------------------------- | ----------------------- |
| Containment | "is part of"           | Tree, one parent, ordered  | `parent_id`, `position` |
| Reference   | "is about", "mentions" | Many to many, no ownership | `item_link_v1`          |

Containment is for checklist lines, subtasks, and tasks in a project. Trashing a parent
trashes its children. A parent cannot be placed inside its own descendant: the service
checks the ancestors before setting a parent, a trigger backs it up, and depth is capped.

Reference is for a time block that points at a task, an item attached to a journal day,
and links between notes. Trashing one end removes the link and leaves the other item.

### Order

`position` is a short text key that sorts alphabetically. Placing an item between `a`
and `m` gives it `g`, so a move writes one row and two devices reordering the same list
do not renumber each other. An item has one key. Every view that offers manual order
sorts by it, so reordering in one view reorders in the others.

### Done

`time_done` is the one record of completion.

- A checklist line is an item with text and a parent. Its checkbox sets or clears
  `time_done`. It has no status, so it is not a task.
- Giving a line a status promotes it: it appears on the task board, and the checklist
  shows its status.
- A task is done when `time_done` is set. Moving it to a status with `is_done` stamps
  `time_done`; moving it to a status without `is_done` clears it. Ticking its checkbox
  stamps `time_done` and, when the workspace has a done status, moves the task to the
  first one. Unticking clears `time_done` and, if the task is in a done status, moves it
  to the first status without `is_done`. Board and checklist both read `time_done`, so
  they agree even when no done status exists. `time_done` is stamped only when it is
  empty, so moving a done task between done statuses keeps its completion time.

## The new types

### Lists

A list is any item with children, so a task with subtasks renders as a checklist too.
A line copies its list's category when created and can be refiled freely. Deleting a
list deletes its lines. Clearing a line's text deletes the line.

Blank lines stay as local drafts until they have text. Lines are saved through a batch
route that creates, updates, and reorders several items in one transaction; each create
names its uid, so a retry stores nothing twice.

A list is embedded as one document: its own text followed by its lines. Lines have no
embedding of their own. A search hit opens the list at the matching line.

### Time blocks

A time block has a start, an optional end, and no required text, status, or date. It is
filed like any item. A check constraint keeps the end after the start.

- A block created in the future starts as planned; one created in the past starts as a
  record.
- Confirming a planned block turns it into a record in place. The plan is not kept.
- A planned block never becomes a record on its own.
- Logging a block over an unconfirmed plan offers to replace the plan.
- Records may overlap and are shown side by side.
- A block without an end is a running timer. Starting a timer stops the running one.

A time block points at a task through a reference link, so trashing the task keeps the
logged time.

### Journal

A journal entry is an item with an `entry_date`, unique per workspace, author, and day
day. It needs no text. A new entry takes today's date, and
the date can be edited.

Changing a date to a day that already has an entry asks whether to combine the two.
Combining appends the text, unions the tags, keeps the target day's filing, moves the
links, and deletes the emptied entry; it is permanent and the prompt says so. Declining
rejects the date change. Restoring a trashed entry onto a day that has gained a new entry
asks the same question; declining leaves it in the trash. Account merge and backup restore combine same-day entries
without asking.

A day shows two sets of items: those that fall on it by their own dates (time blocks,
items due or done that day), which are computed and never stored, and those attached to
the entry by a reference link.

Day boundaries use the user's time zone, stored as a preference. Time blocks are
instants; a journal date is a plain date.

## Backup

A backup is written in two sections: items, each with its uid, then relations by uid
(parents and links). Restore writes the items first and the relations second, mapping
any uid it had to reassign. Duplicate detection judges a tree at its root, so a line is
a duplicate only when its whole list is.

## Sharing

Sharing is per item and per taxonomy level, and content can be published by URL. None of
it is built in this plan, and two structural steps keep it open:

- Every query authorizes through one shared access check instead of repeating the join
  to the workspace's owner.
- Every item records its author.

The later design adds grants (a user, a target that is a workspace, category,
subcategory, or item, and a role), with an item inheriting from its parent and its
filing, and a publish flag that serves an item by its uid.

## Phases

Each phase is one or more pull requests and leaves the app working.

1. **Foundations.**
   - Split the capability registries into content and state; a task requires text and
     a status. Built.
   - Trash. Built.
   - Views declare their selection rule; add the notes filter. Built.
   - Conflict check on update. Built.
   - The shared access check and `author_user_id`.
   - `is_done`, `time_done`, and `position`.
2. **Time blocks.** Columns, the content and status check constraints, the `time`
   kind, the day timeline, the timer.
3. **Journal.** `entry_date`, the `journal` kind, the journal view, combining days.
4. **Lists.** `parent_id`, the batch route, the checklist view, subtasks, list
   embeddings, two-section backups.
5. **Links.** `item_link_v1`, time block to task, items attached to a journal day.
6. **Calendar.** One view of every dated item.
7. **Finish the task view** with manual order, done statuses, and subtasks.

## Deferred

- Recurring items. Each occurrence will be a real item created when the previous one
  completes.
- Delivering reminders. `time_remind` is stored and nothing sends it.
- Sharing screens, grants, and publishing.
- Location, events, files, bookmarks, contacts, and money.
- Keeping a list's lines when the list is deleted.
