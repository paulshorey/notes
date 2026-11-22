# Plan: item content types and relations

This plan extends the item model so one record can be a note, a task, a checklist, a
time block, or a journal entry, and so items can relate to each other. It builds on
[item core](../db/item-core.md) and [item taxonomy](../db/item-taxonomy.md), and each
phase updates those documents when it ships.

Phase 1 is built, and phase 2 is built except for one prompt, listed under
[Phases](#phases). Phase 3, the journal, is next.

The structure is the commitment. The detailed rules for what happens when a property is
removed are added rule by rule as each type is built and tested.

## Principles

- **One record, many views.** An item is never converted between types. A view only
  presents items; an edit made in one view is the same edit everywhere.
- **No stored type.** A kind is computed from what the item holds.
- **Deleting takes the whole item.** Delete in any view sends the item to the trash
  with everything it holds: a deleted time block takes its text with it, and a deleted
  note takes its time block. Taking one thing off an item, such as its status or a
  date, is an edit and leaves the rest.
- **Everything stays inside one workspace.** A parent, a link, a category, a status,
  and a tag always belong to the item's workspace, enforced by composite foreign keys.
- **Declared once.** Every new column or table is declared in
  `sql/item/stored-capabilities.ts`, so backup, restore, duplicate detection, account
  merge, and the trash carry it, and `db:verify` fails when one is missed.

## Content and state

What an item holds is split into two groups.

| Group   | Members                                                          | Rule                                     |
| ------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Content | text, time block, journal date                                   | An item holds at least one.              |
| State   | status, done, due date, reminder, parent, position, filing, tags | Describes an item; never keeps it alive. |

Two rules follow:

- An item without content is not kept.
- A status and a parent each require text.

A date alone does not make an item. A location is a later state field that turns a
dated item into an event.

The item service enforces both rules, and check constraints on the item table repeat
them, so no path can store an item the rules refuse.

## Kinds and views

| Kind      | An item is this kind when it holds | View                       | Phase |
| --------- | ---------------------------------- | -------------------------- | ----- |
| `note`    | text                               | notes                      | Built |
| `task`    | text and a status                  | tasks: board and list      | Built |
| `time`    | a time block                       | time: day timeline         | 2     |
| `journal` | a journal date                     | journal: one entry per day | 3     |
| `list`    | children                           | lists: nested checklist    | 4     |

Each kind has its own screen. A calendar view is a sixth screen that lists every item
with any date; it is a view, not a kind.

A view declares which items it lists. The notes view lists every item with text and
lets the user leave out the kinds that have a view of their own; the choice is a
preference. Tasks, journal entries, and time blocks are shown unless hidden. List lines
are hidden unless shown.

Because every item holds content and each content type has a view that lists it, no
item can become invisible.

## Storage

Columns each phase adds to `workspace_item_v1`:

| Column         | Type        | Purpose                                           | Phase |
| -------------- | ----------- | ------------------------------------------------- | ----- |
| `time_start`   | timestamptz | Start of a time block.                            | 2     |
| `time_end`     | timestamptz | End of a time block; set whenever the start is.   | 2     |
| `time_planned` | boolean     | A plan not yet confirmed, as opposed to a record. | 2     |
| `entry_date`   | date        | The calendar day of a journal entry.              | 3     |
| `parent_id`    | integer     | The item that contains this one.                  | 4     |
| `position`     | text        | Fractional order key.                             | 4     |
| `time_done`    | timestamptz | When the item was completed; null while open.     | 4     |

Phase 4 also adds `is_done` to `workspace_status_v1`, so a status can mean completed.
Phase 5 adds the table `item_link_v1`: `from_item_id`, `to_item_id`, `workspace_id`,
`relation`, `position`. Both item keys are composite with `workspace_id`.

Scalar fields that an item holds once stay as columns. Anything an item holds many of
gets its own table keyed by item id. There is no generic JSON content column, because it
would bypass constraints, typed backup fields, and the storage audit.

Two parts of phase 1 shape the later phases:

- **Trash.** Deleted items leave the item table for `user_item_trash_v1`, which keeps
  each as its backup fields ([item core](../db/item-core.md#trash)). No query over
  items has to exclude trashed rows, a unique rule such as one journal entry per day
  needs no exception for them, and a trashed list is stored as its lines together.
- **Versions.** An update names the `time_modified` of the version it edited and is
  refused when the stored item has changed since
  ([item core](../db/item-core.md#concurrent-edits)). The modification time is the
  version, so there is no revision column.

## Relations

| Relation    | Meaning                | Shape                      | Stored as               | Phase |
| ----------- | ---------------------- | -------------------------- | ----------------------- | ----- |
| Containment | "is part of"           | Tree, one parent, ordered  | `parent_id`, `position` | 4     |
| Reference   | "is about", "mentions" | Many to many, no ownership | `item_link_v1`          | 5     |

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
  `time_done`; moving it to a status without `is_done` clears it.
- Ticking a task's checkbox stamps `time_done` and, when the workspace has a done
  status, moves the task to the first one. Unticking clears `time_done` and, if the
  task is in a done status, moves it to the first status without `is_done`.
- Board and checklist both read `time_done`, so they agree even when no done status
  exists.
- `time_done` is stamped only when it is empty, so moving a done task between done
  statuses keeps its completion time.

## The new types

### Time blocks

A time block is a start and an end on an item. Both are set, and they may be the same
instant: given only one, the other takes its value. A block needs no text, status, or
date, and it is filed like any item. Check constraints keep the two ends together and
in order. There are no running timers.

- A block created in the future starts as planned; one created in the past starts as a
  record.
- Confirming a planned block turns it into a record in place. The plan is not kept.
- A planned block never becomes a record on its own.
- Logging a block over an unconfirmed plan offers to replace the plan.
- Records may overlap and are shown side by side.

The time view shows blocks on a timeline at four fixed ranges: a few hours around now,
a day, a week that starts on Monday, and a month. Hours, day, and week draw time down
the page with one column per day. Month is a calendar grid with a summary per day. A
block is created and edited in a form. It shows its text, or "no text", with its
category underneath in small print.

From phase 5 a time block can point at a task through a reference link, so trashing
the task keeps the logged time.

### Journal

A journal entry is an item with an `entry_date`, and a workspace has one entry per day.
It needs no text. A new entry takes today's date, and the date can be edited.

Changing a date to a day that already has an entry asks whether to combine the two.
Combining appends the text, unions the tags, keeps the target day's filing, moves the
links, and deletes the emptied entry; it is permanent and the prompt says so. Declining
rejects the date change. Restoring a trashed entry onto a day that has gained a new
entry asks the same question; declining leaves it in the trash. Account merge and
backup restore combine same-day entries without asking.

A day shows the items that fall on it by their own dates: time blocks, and items due or
done that day. These are computed and never stored. From phase 5 it also shows the
items attached to the entry by a reference link.

Day boundaries use the user's time zone, stored as a preference. Time blocks are
instants; a journal date is a plain date.

### Lists

A list is any item with children, so a task with subtasks renders as a checklist too.
A line copies its list's category when created and can be refiled freely. Deleting a
list deletes its lines. Clearing a line's text deletes the line.

Blank lines stay as local drafts until they have text. Lines are saved through a batch
route that creates, updates, and reorders several items in one transaction; each create
names its uid, so a retry stores nothing twice.

A list is embedded as one document: its own text followed by its lines. Lines have no
embedding of their own. A search hit opens the list at the matching line.

A backup is written in two sections once items have parents: items, each with its uid,
then relations by uid, which are parents and, from phase 5, links. Restore writes the
items first and the relations second, mapping any uid it had to reassign. Duplicate
detection judges a tree at its root, so a line is a duplicate only when its whole list
is.

## Sharing

Sharing is per item and per taxonomy level, and content can be published by URL. It is
designed after this plan, as one piece, because what it needs depends on that
granularity:

- **Access.** Every query now checks that the workspace belongs to the acting user.
  Sharing replaces that with grants: a user, a target that is a workspace, category,
  subcategory, or item, and a role, with an item inheriting from its parent and its
  filing.
- **Authors.** An item records who created it once a workspace can hold more than one
  person's items. One journal entry per day then becomes one per author per day, and
  time blocks belong to a person.
- **Publishing.** A publish flag serves an item by its uid.

## Phases

Each phase is one or more pull requests and leaves the app working.

1. **Foundations.** Built.
   - Capabilities are content or state, and a task is text with a status.
   - Deleted items go to the trash.
   - Each view declares its selection, and the notes view has its filter.
   - An update is refused when it would write over a change made elsewhere.
2. **Time blocks.**
   - The three time columns, the content and status check constraints, and the `time`
     kind. Built.
   - The time view: the form, and the hours, day, week, and month ranges. Built.
   - Offering to replace an unconfirmed plan when a record is logged over it.
3. **Journal.** `entry_date`, the `journal` kind, the journal view, combining days.
4. **Lists.** `parent_id`, `position`, `time_done`, done statuses, the batch route,
   the checklist view, subtasks, list embeddings, two-section backups.
5. **Links.** `item_link_v1`, time block to task, items attached to a journal day.
6. **Calendar.** One view of every dated item.
7. **Finish the task view** with subtasks, manual card order, and done columns.

## Deferred

- Sharing, as described above.
- Recurring items. Each occurrence will be a real item created when the previous one
  completes.
- Delivering reminders. `time_remind` is stored and nothing sends it.
- Location, events, files, bookmarks, contacts, and money.
- Keeping a list's lines when the list is deleted.
