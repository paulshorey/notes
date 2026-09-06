# Handoff: taxonomy hierarchy frontend

**Audience:** the next engineer or AI agent continuing the Epic > Category > Group > Note work.
**Status as of 2026-09-06:** backend and schema are live in production (`jot.new`). The web client has working plumbing and a first-pass tree, but the UI still reads like a flat category app stretched onto a hierarchy. That is the remaining work.
**Do not start by changing schema or `/api/taxonomy`.** The API is done. Work in `apps/notes-next`.

Related history:

- [PR #70](https://github.com/paulshorey/notes/pull/70) — hierarchy + web/Android contract cutover
- [PR #72](https://github.com/paulshorey/notes/pull/72) — dropped leftover `user_note_category_v1` / `category_id` (applied on production)
- [PR #69](https://github.com/paulshorey/notes/pull/69) — multi-note editor ring (already shipped; do not regress it)
- Original design: `.cursor/plans/notes_taxonomy_hierarchy_ef14c016.plan.md` (long; Part 6 is the client contract)
- Deploy record: `.cursor/plans/deploy_taxonomy_hierarchy.md`

The original plan marks `frontend` and `tier_rename_ui` as completed. That is **wrong**. Those todos shipped the data plumbing and a first tree, not a finished UI. Trust this document and the code over those checkboxes.

---

## 1. What this product is

Notes sit in a **strict four-level hierarchy**:

```
Epic (level 1)
  └── Category (level 2)
        └── Group (level 3)   ← notes attach here only
              └── Note        ← level 4 is a vocabulary word only, not a table row
```

Tags stay many-to-many on notes. They are orthogonal to the tree.

The words “Epic / Category / Group / Note” are **per-user data** (`user_taxonomy_level_v1`). The program must branch only on `level` (1–4). A URL, cache key, `if (label === "Category")`, or comparison built on a tier name breaks the first time someone renames it.

Production: https://jot.new. Schema Phase 2 is applied: `user_note_v1.group_id` is the only note-to-taxonomy FK. The old category table is gone.

---

## 2. Mental model the frontend must keep

These rules are load-bearing. Breaking them silently loses drafts or never saves.

1. **A draft holds one taxonomy field: `selectedGroupId`.** Epic and category are derived from the tree (`taxonomyIndex.pathByGroupId`). Never store them on the entry or put them in `serializeNoteDraft`. Picker navigation lives on the open-note entry as `groupInputValue`, not in `NoteFormState`, so browsing the picker does not mark the note dirty.

2. **Never branch on a tier label.** Use `TAXONOMY_LEVEL_*` constants and ids. `taxonomyLabels` in `NotesApp` is display-only.

3. **A programmatic form change must not leave an entry dirty.** Reconciliation, taxonomy remap, sidebar moves, and `applyServerNoteToEntry` must recompute `savedSignature` when the user did not type. Otherwise autosave immediately PATCHes the change back — on the anonymous-merge path that overwrites merged ids with anonymous-side ones.

4. **`remapEntriesAfterTaxonomyChange` runs before the delete request**, and it must cover `detachedSavesRef` as well as the ring. An evicted dirty draft pointing at a deleted group 400s for a note the user cannot see.

5. **Async create handlers capture `targetKey` before `await`.** Several notes are open. A group created for note A must not land on whichever note is active when the response returns.

6. **Sidebar-move of an open note edits the draft and lets autosave carry it.** Never `PATCH` the stored description over a live draft (`patchNoteFromSidebar` is only for notes that are not open). This was a live data-loss bug (plan §6.7a).

7. **Without a group, `isSaveableForm` is false and autosave returns before the network.** The local snapshot still shows the note. That is indistinguishable from success. The `blocked` save status exists for this and is **not wired** (see §5).

8. **Do not bump `notes-open-notes-v1` `schemaVersion` without an upgrade path.** `isSnapshot` rejects unknown versions; the caller treats `null` as “nothing to restore” and silently discards every unsaved draft.

9. **Zustand selectors must return an existing reference or a primitive.** Building a new object/array in the selector hangs the app in an infinite loop.

10. **Confirm persistence in Postgres or the network tab, not the screen.** `localStorage` faithfully reproduces notes that never reached the server. See `apps/notes-next/AGENTS.md` (“Verify at a layer the UI cannot fake”).

---

## 3. Backend (done — read, do not redesign)

### Tables

| Table                    | Role                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_taxonomy_level_v1` | Per-user words for levels 1–4. Case preserved. Unique on `lower(label)` per user.                                                                   |
| `user_taxonomy_v1`       | One self-referencing tree. `level` 1–3. Generated `parent_level` + composite FKs enforce depth, parent level, and same-user ownership. No triggers. |
| `user_note_v1.group_id`  | Required. `group_level` CHECK (= 3). Composite FK so a note cannot attach to an epic, a category, or someone else’s group.                          |

Every user needs a full epic → category → group chain. `createAnonymousUser` seeds it. `GET /api/taxonomy` repairs it lazily. Default auto-created labels are `uncategorized`.

Item labels are lowercase (`CHECK`). Upsert-by-label uses `ON CONFLICT … DO UPDATE … RETURNING id` (not `DO NOTHING`) because concurrent group creates from the ring are reachable.

Delete requires an explicit `mode`: `reassign-children` or `delete-subtree`. No default.

Canonical types: `lib/db-notes/contracts/notes-app.ts`.
SQL: `lib/db-notes/sql/taxonomy.ts`, `lib/db-notes/sql/taxonomy-level.ts`.
Service: `lib/db-notes/services/notes-app.ts`.
Gotchas: `lib/db-notes/AGENTS.md` (Taxonomy section).

### API (all live)

Auth: session cookie (web) or bearer token (Android). Client-supplied `userId` is overwritten.

| Method    | Path                    | Purpose                                         | Used by web UI?                        |
| --------- | ----------------------- | ----------------------------------------------- | -------------------------------------- |
| GET       | `/api/taxonomy`         | Flat tree + `levels`. Lazy-seeds chain.         | Yes                                    |
| POST      | `/api/taxonomy`         | Create node `{ level, parentId, label }`        | Groups only                            |
| PATCH     | `/api/taxonomy`         | Rename **or** move (`parentId`), not both       | Rename only                            |
| DELETE    | `/api/taxonomy`         | `{ taxonomyId, mode }`                          | Yes                                    |
| GET/PATCH | `/api/taxonomy/levels`  | Rename a tier word                              | **No UI**                              |
| POST      | `/api/taxonomy/path`    | Atomic epic/category/group resolve-or-create    | Fallback when there is no parent chain |
| POST      | `/api/taxonomy/suggest` | Level-scoped autocomplete (literal + embedding) | **No UI**                              |

Notes: `POST/PATCH /api/notes` take `note.groupId`. `NoteRecord` returns `groupId` only — clients resolve the path from the tree they already hold.

`/api/categories` is gone (404).

### Production-only leftovers (do not migrate away)

Production has two migrations this repo does not own:

- `202604071200__gemini_embedding_001_768.sql`
- `202606201200__user_workflow_status.sql` (`user_workflow_status_v1`, `user_note_v1.workflow_status_id` / `time_completed`)

Leave them alone. Anonymous merge still deletes cleanly (`ON DELETE CASCADE`).

### Deferred (not frontend)

- Bulk backfill of `user_taxonomy_v1.label_embedding`. Until then, `/api/taxonomy/suggest` is literal-only for most rows. `scripts/regenerate-embeddings.mjs` still covers notes + tags only.
- Android hierarchy UI. The APK is contract-compatible (`groupId`, full tree in the snapshot) but the UI is still a **flat list of level-3 groups** labeled “categories”. Product stance: finish the web app first (`AGENTS.md`).

---

## 4. What the web frontend already does

Working, do not rip out:

- Three-level expandable sidebar tree in `ResultsColumn.tsx` (epic → category → group → notes).
- `src/lib/taxonomyIndex.ts` — `byId`, `childrenOf`, precomputed `pathByGroupId` with **stable object identity**. Built once in `NotesApp` via `useMemo` and passed down. A group id absent from the tree yields `undefined`, not a throw.
- Draft model on `selectedGroupId`; open-notes storage upgrades v1 `selectedCategoryId` → v2 group.
- URL: `?id=`, `?group=`, `?tags=` (ids, not labels). `replaceState` mirrors the **active** entry only.
- Rename / delete any taxonomy node (shared modals; copy still says “category”).
- Create a **group** from the note-form picker or a sidebar move.
- Move a note between groups (open notes go through the draft; closed notes PATCH).
- Recent-notes menu shows `epic › category › group` breadcrumbs.
- `remapEntriesAfterTaxonomyChange` before delete; merge remaps applied to the ring.
- Mobile results drawer.

Production users have been using this since PR #70. Data is organized correctly. The complaint is the **experience**, not missing persistence.

---

## 5. What is unfinished (start here)

Priority is product/UX, not more API. Suggested order:

### P0 — correctness the user can already hit

1. **Wire `blocked` save status.**
   `isBlockedForm` exists in `src/lib/noteDraft.ts`. Header copy exists (`NotesHeader.tsx`: “Cannot save yet — choose where this goes”). The status effect in `NotesApp.tsx` only ever sets `idle | unsaved | saved`. A draft with text and no group looks “unsaved” while autosave silently skips. In the effect around the `isEntryDirty` branch, if `isBlockedForm(entry.form)` set `blocked`.

2. **Show the full path in pickers.**
   `NoteForm` already builds `path: "epic → category → group"` and **filters** on it, but `FilterablePickerPopup` renders `option.label` only. Two groups named `uncategorized` (the common production case after the backfill) are indistinguishable. Same problem in the sidebar move picker. Either show `path` as the row label / secondary line, or extend `FilterablePickerPopup` to accept an optional description.

### P1 — the hierarchy is not editable as a hierarchy

3. **Create epic and category from the sidebar.**
   Today the user can only create **groups**, and only under the current note’s category (or via `/api/taxonomy/path` with hardcoded `uncategorized` / `uncategorized` / `<label>`). There is no “add child” on an epic or category row. Backend: `POST /api/taxonomy` with `level` + `parentId`. Capture `targetKey` if the create also selects a group for an open draft.

4. **Reparent / move a taxonomy node.**
   `PATCH /api/taxonomy` with `parentId` is implemented. The UI never sends it. Sibling-label conflict returns 400 `"Something with that name is already there."` Invalid parent: `"That is not a valid place to move this to."` No drag-and-drop is required for a first version — a “move to…” picker that lists legal parents (epic for a category, category for a group) is enough.

5. **Tier-name editor.**
   `GET/PATCH /api/taxonomy/levels` is live. Session already returns `taxonomyLevels`. There is no settings UI. Adding one in the user menu is the intended place (`notesApp.*` preferences already live there). Remember: singular only, no pluralization. A sidebar heading reads whatever the user typed (`Category`, not `Categories`).

6. **Level-aware modal copy.**
   `EditCategoryModal` / `DeleteCategoryModal` say “category” for every level. Use `taxonomyLabels` + `node.level`. Same for overflow-menu labels and the “default group cannot be deleted” string.

### P2 — polish and leftover category language

7. **Rename leftover identifiers** as you touch files (`editingCategory`, `categoryPickerOpen`, `allCategoryItems`, CSS `categoryRow`, move-picker `kind: "category"` meaning group). Do not do a repo-wide rename as its own PR unless asked — it is a noisy diff on a 3k-line `NotesApp.tsx`.

8. **Dead props.** `ResultsColumn` still receives `allCategoryItems`, `allCategoriesNoteCount`, `allTagItems` and does not use them.

9. **Stale comments.** `notesAppStore` still says “only one category can be expanded”; `expandedTaxonomyIds` is an array and many nodes can be open. `applyNotesUrlSelection` comments still mention `?category=`.

10. **Cache first paint.** `notes-app-cache-v2` stores taxonomy **rows**, not `levels`. Custom tier names flash default English until `loadTaxonomy`. Session already has `taxonomyLevels` — persist them on the cache snapshot or paint from the session payload first.

11. **Empty states.** Expanded group with zero notes shows nothing. Picker empty copy is generic.

12. **`POST /api/taxonomy/suggest`.** Optional. The current picker is a client-side filter over the already-loaded tree, which is enough at current scale. Wire suggest only if the tree gets large or you add typeahead when creating a node under a parent.

13. **Breadcrumb on the editor** (not just Recent). The form trigger shows the group name only.

Out of scope unless asked: drag-and-drop, Android tree UI, embedding backfill, rewriting `NotesApp.tsx` from scratch.

---

## 6. File map

| File                                                                  | Why it matters                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/notes-next/AGENTS.md`                                           | Ring + taxonomy invariants. Read before editing.               |
| `apps/notes-next/src/components/notes/NotesApp.tsx`                   | Orchestrator (~3k lines). Load, URL, CRUD, remap, save engine. |
| `apps/notes-next/src/components/notes/ResultsColumn.tsx`              | Sidebar tree.                                                  |
| `apps/notes-next/src/components/notes/NoteForm.tsx`                   | Editor + group picker.                                         |
| `apps/notes-next/src/components/notes/NotesHeader.tsx`                | Recent breadcrumbs, save indicator.                            |
| `apps/notes-next/src/components/notes/modals/EditCategoryModal.tsx`   | Rename any node; “category” copy.                              |
| `apps/notes-next/src/components/notes/modals/DeleteCategoryModal.tsx` | Delete disposition; “category” copy.                           |
| `apps/notes-next/src/components/ui/FilterablePickerPopup.tsx`         | Shared popup; renders `label` only.                            |
| `apps/notes-next/src/lib/taxonomyIndex.ts`                            | Tree index. Keep it pure.                                      |
| `apps/notes-next/src/lib/noteDraft.ts`                                | Signature, saveable, blocked.                                  |
| `apps/notes-next/src/lib/openNotesStorage.ts`                         | Ring persistence + v1→v2 upgrade.                              |
| `apps/notes-next/src/stores/notesAppStore.ts`                         | Zustand + ring actions.                                        |
| `apps/notes-next/src/stores/openNotes.ts`                             | Pure ring reducers. Insert → activate → evict.                 |
| `apps/notes-next/src/types/notes.ts`                                  | `NoteFormState`, `NoteSaveStatus`.                             |
| `lib/db-notes/contracts/notes-app.ts`                                 | Canonical types and level constants.                           |
| `lib/db-notes/sql/taxonomy.ts`                                        | Server tree + delete/move/suggest.                             |

UI libraries: Gravity UI (`@gravity-ui/uikit`) and Mantine. No Tailwind. Skills: `.cursor/skills/gravity-ui-*`.

---

## 7. How to work

- `pnpm` only, repo root.
- Cloud workspace: `DB_NOTES_URL` / `DB_NOTES_TEST_URL` are local throwaway DBs. `pnpm run db:migrate` if schema is empty. Never point `db:verify` at production (it rewrites generated files).
- Dev: `pnpm --filter notes-next dev` (editor package must be built; `notes-next` build does that).
- Tests: `pnpm --filter notes-next test` (node runner, **no DOM**). Keep new ring/index/draft logic in pure modules. Do not add a React Testing Library stack casually.
- Existing tests to keep green: `test/open-notes*.ts`, `test/notes-api-adapter.test.ts`. There is **no** `taxonomyIndex` unit test yet; adding one (absent group id → `undefined` path) is cheap and useful.
- After UI changes, verify in the browser: create/rename/delete at each level, move a note that is open and dirty, reload with `localStorage` cleared, and confirm the row in Postgres.

### Suggested first PR

Small and reviewable: **P0 only** (wire `blocked` + show paths in both pickers). Then a second PR for sidebar create/reparent (P1). Then tier rename + modal copy. Resist combining all of §5 into one diff.

---

## 8. Product decisions already made

Do not reopen these unless asked:

- Notes attach only to groups. The schema forbids anything else.
- Draft stores the leaf id only.
- URL stores ids (`?group=`), not labels.
- Tier names are singular, per user, one vocabulary. Merge of an anonymous account **drops** the visitor’s tier rename (`user_taxonomy_level_v1` strategy is `drop`).
- Delete always requires `mode`. Last sibling at a level cannot be deleted (nowhere to reassign).
- One mounted `AtomicEditor`, not one per open note. `documentId={`${entry.key}:${entry.editorSessionId}`}`.
- Ring cap is `notesApp.maxOpenNotes` (default 10), persisted separately from `notesCache`.
- Semantic search is description-only. Taxonomy embeddings are for suggest, not ranking.
- Android waits until the web UI is stable.

Open product questions (from the original plan, still unanswered):

- Should the sidebar mark _open_ notes (in the ring) vs only the _active_ one?
- Does the Recent dropdown need an explicit close on every row? (It already has close in the shipped ring UI — confirm before changing.)
- Drag-and-drop vs picker for reparent.

---

## 9. What “done” looks like for the frontend

A user who never saw the old flat-category app should be able to:

1. See a tree whose headings use **their** tier words.
2. Create an epic, a category under it, and a group under that, from the sidebar.
3. File a note in a group and see the full path in the editor and in pickers.
4. Move a group to another category, and a category to another epic, without losing notes.
5. Rename or delete a node with copy that names the correct tier and the chosen disposition.
6. Type in a note with no group and see **blocked**, not a fake “unsaved”.
7. Hard-refresh with cache cleared and still see the same tree and notes from the server.

Until those are true, the hierarchy is a backend feature with a transitional UI.
