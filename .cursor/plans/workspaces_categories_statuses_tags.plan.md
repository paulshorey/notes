---
name: Workspace-scoped notes, categories, statuses, and tags
overview: Replace the rejected strict Epic > Category > Group hierarchy with an independent task-management model. Every note belongs to exactly one user-owned workspace, may belong to many categories, may have one optional status, and may belong to many tags. Categories, statuses, and tags are flat workspace-scoped vocabularies rather than parent/child folders. The web app loads and edits one active workspace at a time, while authentication and anonymous-account merging remain user-scoped.
todos:
  - id: schema
    content: Add the workspace-owned relational schema, reset demo note/taxonomy content safely, seed one default workspace and its default category/status/tag for every user, and enforce same-workspace note relations with composite foreign keys.
    status: completed
  - id: contracts_sql
    content: Replace user-scoped category/tag and single-category note contracts with workspace records, workspace-scoped category/status/tag records, category/tag link arrays, nullable status, and workspace-aware SQL CRUD/list/search operations.
    status: completed
  - id: account_lifecycle
    content: Seed workspace defaults during anonymous-account creation and implement anonymous-to-real merge for workspaces, vocabulary rows, notes, and links without cross-workspace references.
    status: completed
  - id: api
    content: Add workspace and status endpoints, make notes/categories/tags/search/bootstrap workspace-aware, and keep authenticated user ownership authoritative at every route boundary.
    status: completed
  - id: web_state
    content: Add active-workspace state and switching, migrate note drafts from one category id to category id arrays plus nullable status id, scope caches/open-note persistence to a workspace, and preserve the existing autosave/ring invariants.
    status: completed
  - id: web_ui
    content: Add a workspace switcher/creator, status controls, multi-category note editing, and independent category/status/tag sidebar groupings and filters.
    status: completed
  - id: android_contract
    content: Update the Android API models/codec/repository enough to consume the new workspace-aware contract; defer richer Android workspace UX until the web product stabilizes.
    status: completed
  - id: verification
    content: Extend schema/contract assertions and regression coverage, regenerate committed artifacts, run database migration/verification plus web tests/build and Android contract/build checks, then create the comprehensive PR handoff.
    status: completed
isProject: true
---

# Workspace-scoped notes plan

## 1. Product decisions encoded by this plan

This design replaces the folder-like hierarchy from PR #70. There is no generic
taxonomy tree and no parent/child relationship among category, status, and tag.
They are three independent flat vocabularies under a workspace.

Relationship cardinality:

| Relation          | Cardinality           | Behavior                                                                                                    |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| user -> workspace | one-to-many           | A user can switch among and create workspaces.                                                              |
| workspace -> note | one-to-many           | Every note belongs to exactly one workspace.                                                                |
| note <-> category | many-to-many          | A note can have zero or more categories. A new draft starts with the workspace's default category selected. |
| note -> status    | many-to-one, nullable | A note can have no status or one workspace status.                                                          |
| note <-> tag      | many-to-many          | A note can have zero or more tags.                                                                          |

Initial defaults are data, not special enum values:

- New account: workspace `personal`.
- New workspace: category `uncategorized`, status `backlog`, tag `important`.
- Creating a category, status, or tag affects only its vocabulary; it never
  changes the active workspace and never relocates existing notes.

Labels are normalized to trimmed lowercase, as category and tag labels are
today. Workspace labels are also normalized for consistent uniqueness. The
status labels suggested by the product (`backlog`, `todo`, `in progress`,
`testing`, `qa`, `done`) are ordinary user-created rows; only `backlog` is
seeded so a fresh workspace is intentionally sparse.

## 2. Database model

Use explicit tables instead of the rejected self-referencing taxonomy table:

```text
user_v1
  └── user_workspace_v1 (id, user_id, label)
        ├── workspace_note_category_v1 (id, workspace_id, label, embedding...)
        ├── workspace_note_status_v1   (id, workspace_id, label, position)
        ├── workspace_note_tag_v1      (id, workspace_id, label, embedding...)
        └── user_note_v1               (id, workspace_id, status_id?, body/dates/embedding...)
              ├── user_note_category_link_v1 (note_id, category_id, workspace_id)
              └── user_note_tag_link_v1      (note_id, tag_id, workspace_id)
```

`user_note_v1` no longer has `user_id` or a single `category_id`; ownership is
derived through `workspace_id`. Each vocabulary table is unique on
`(workspace_id, label)`. Every parent table exposes a unique `(id,
workspace_id)` key. Status and both link tables carry `workspace_id` so
composite foreign keys make cross-workspace attachment impossible in the
database, not merely in service code.

Deleting a workspace cascades its notes and vocabulary. The API must require an
explicit confirmation mode and must refuse to delete a user's last workspace.
Deleting a category or tag removes only links. Deleting a status sets matching
notes to `NULL`. Defaults are initial data rather than undeletable records; if a
workspace has no categories, new drafts are still saveable with an empty
category list.

Because the application has no real user data, use one intentionally destructive
cutover migration for note/taxonomy tables while preserving `user_v1` and API
tokens. Drop stale PR #70 taxonomy/workflow objects with `IF EXISTS`, recreate
the workspace model, discard demo notes, and seed defaults for every existing
user. This migration must work both after the repository's current baseline and
against the development database that previously saw experimental migrations.

## 3. Contracts and service boundary

Add:

- `WorkspaceRecord { id, userId, label, noteCount }`
- `StatusRecord { id, workspaceId, label, position, noteCount, lastUsedAt }`
- workspace-scoped `CategoryRecord` and `TagRecord`
- `NoteRecord { id, workspaceId, categories[], status|null, tags[], ... }`
- `NoteInput { workspaceId, categoryIds[], statusId|null, tagIds[], ... }`
- a bootstrap payload containing the user, all workspace summaries, the active
  workspace id, and only that workspace's notes/categories/statuses/tags.

All mutations accept a workspace id and then authorize it against the
authenticated user. Update/delete by note id must join through the workspace to
prove ownership. Category, status, and tag ids are validated as belonging to
the note workspace before a transaction replaces relations.

Search remains description-only (the simplification already on `main`) and is
restricted to the active workspace. Category/tag label embeddings remain for
maintenance and future suggestions; status labels do not need embeddings yet.

## 4. Account lifecycle and anonymous merge

Create the default workspace and all three default vocabulary rows in the same
transaction that creates an anonymous user. Also retain a lazy ensure path for
pre-existing users with no workspace.

For anonymous sign-in to an existing account:

1. Match workspaces by normalized label.
2. For a collision, merge the anonymous workspace into the real workspace;
   otherwise transfer it to the real user.
3. Within a collided workspace, deduplicate category, status, and tag labels and
   build id maps.
4. Move notes to the destination workspace, remap status ids, and rebuild
   category/tag links from the maps.
5. Merge preferences as today, remove the anonymous user, and return the user.

This preserves semantic workspace boundaries and avoids flattening every
anonymous note into whichever real workspace happens to be active.

## 5. API and web loading model

`GET /api/bootstrap?workspaceId=<id>` is the single cold-start/workspace-load
path. If the requested id is absent or unauthorized, choose the user's saved
`notesApp.currentWorkspaceId` when valid, otherwise the first workspace. Return
all workspace summaries plus only the chosen workspace's content.

Add `/api/workspaces` CRUD and `/api/statuses` CRUD. Existing note, category,
tag, search, and maintenance routes become workspace-aware. Creating a workspace
is transactional and returns its summary; the client then loads its seeded
vocabulary through bootstrap and switches to it immediately.

Persist `currentWorkspaceId` in user preferences, but treat it as a hint: the
server validates it on every bootstrap. A workspace switch must flush all dirty
entries before changing context. If a save fails, keep the current workspace
and show the error. On success, load the destination snapshot, clear workspace-
local filters/open editors, and persist the preference.

## 6. Drafts, cache, and autosave safety

Change form state from `selectedCategoryId` to:

```ts
selectedCategoryIds: number[]
selectedStatusId: number | null
selectedTagIds: number[]
```

Include all three in deterministic sorted order in the dirty signature and note
request body. Keep picker-input/navigation state outside the form. Async create
handlers must continue capturing the target open-note key before awaiting.

Scope replaceable cache data and persisted open-note snapshots by workspace id.
Upgrade existing v1 open-note snapshots in place: map `selectedCategoryId` to a
single-element `selectedCategoryIds` array and set `selectedStatusId` to `null`.
Recompute saved signatures for clean entries so migration neither loses drafts
nor creates a save storm. Never silently discard an unknown snapshot.

## 7. Web interaction design

- Put the workspace switcher in the header near the app identity. It lists the
  user's workspaces and includes `Create workspace`.
- The note form uses a multi-select category control, a single optional status
  control with a `No status` option, and the existing multi-select tag control.
- The sidebar has independent `Categories`, `Statuses`, and `Tags` sections.
  Expanding a row filters/groups notes related to that row; notes can appear
  under multiple category and tag rows. Provide an `Uncategorized`/`No status`
  view for zero-category/null-status notes rather than inventing hidden rows.
- Category/status/tag creation stays in the current workspace. Move actions for
  categories/tags mean add/remove membership; status movement means replacement.
- On workspace change, no records from the previous workspace remain visible or
  selectable.

## 8. Android scope

Update generated-contract consumers so Android remains buildable and cannot send
obsolete single-category payloads. Persist the selected workspace and workspace
snapshot, and expose a basic workspace/status/category mapping. Rich workspace
management UI can follow after the web app is validated; the web app remains the
product source of truth.

## 9. Verification and rollout

Database tests must prove:

- defaults are seeded once for account and workspace creation;
- same label is allowed in two workspaces but rejected twice in one workspace;
- cross-workspace status/category/tag attachment is rejected by PostgreSQL;
- category and tag relations replace atomically and allow multiple ids;
- status can be `NULL` and can be replaced;
- workspace-scoped list/search never leaks another workspace;
- anonymous merge preserves collided and non-collided workspaces;
- deleting a user/workspace leaves no orphans.

Client tests must pin v1 draft upgrade, deterministic multi-id signatures,
workspace cache isolation, switch-after-flush behavior, and note filtering across
all three dimensions.

Run the repository-mandated order: `pnpm run db:migrate`, `pnpm run db:verify`,
then the root verification/release checks. Apply the migration before deploying
the web app because the cutover intentionally has no legacy dual-write window.
Since all existing note content is demo data and backed up, rollback is code plus
database restore rather than a reverse data migration.
