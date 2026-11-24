# Item API

`apps/notes-next` serves these routes over the item service. All but
`GET /api/items/model` are authenticated. The web UI edits text items and calls them
notes.

## Source of truth and identity

- Payloads: `contracts/items-app.ts`
- Generated artifact: `generated/contracts/items-app.json`
- Workflows and parsers: `services/items-app.ts`
- HTTP factories: `apps/notes-next/app/api/_lib/items-app-route-handlers.ts`

Data routes derive the user from an Auth.js session cookie or
`Authorization: Bearer <token>`. Client-provided user IDs never establish identity.
Unauthenticated calls return `401`. `POST /api/auth/token` accepts credential
`identifier` and `password` and returns `{ token, user }`; `DELETE` revokes the
presented token. Token hashes are stored in `user_api_token_v1`.

## Item operations

| Route                                    | Request                                              | Response                                                 |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/items/model`                   | None; no authentication                              | The item model                                           |
| `GET /api/items?workspaceId=...`         | Authorized workspace                                 | `{ items: ItemRecord[] }`                                |
| `POST /api/items`                        | `{ item: ItemInput }`                                | `201 { item }`, or `200 { item }` for a uid that exists  |
| `PATCH /api/items`                       | `{ itemId, item: ItemPatch, expectedTimeModified? }` | `{ item }`, or `409 item_changed` with the stored item   |
| `DELETE /api/items`                      | `{ itemId }`                                         | `{ ok: true }`; the item goes to trash                   |
| `POST /api/items/journal`                | `{ itemId, entryDate }`                              | `{ item }`, the entry the item was combined into         |
| `GET /api/items/trash?before=<id>`       | Optional `before`                                    | `{ items: TrashedItemRecord[], hasMore, retentionDays }` |
| `POST /api/items/trash`                  | `{ trashId, combineJournalDay? }`                    | `{ item }`, restored                                     |
| `DELETE /api/items/trash`                | `{ trashId? }`                                       | `{ ok: true, purged }`                                   |
| `POST /api/items/search`                 | `{ workspaceId, query, limit }`                      | `{ results: [{ item, similarity }] }`                    |
| `POST /api/items/maintenance/embeddings` | `{ mode, limit }`                                    | `{ mode, processed, updated, hasMore }`                  |

`GET /api/items/model` answers what an item can hold, which combinations are which
kinds, and what a write does (`contracts/item-model.ts`; see
`docs/db/item-model.md`). Read it instead of assuming the rules below.

`ItemInput` is a whole item: `workspaceId`, an optional `uid`, nullable `categoryId`,
`subcategoryId`, and `statusId`, `tagIds`, nullable `description`, `timeDue`,
`timeRemind`, the time block `timeStart` and `timeEnd`, and the journal day `entryDate`
as `YYYY-MM-DD`. A field a create leaves out is empty.

`ItemPatch` has the same fields, all optional, and no `uid`. A field absent from the
patch is left as stored, `null` clears it, and `tagIds: []` removes every tag.
`workspaceId` must name the item's workspace when given. The save rules apply to the
merged result: `400 content_required` when it would hold no content (text, a time
block, or a journal day), and `400 requirement_missing` when a state lacks what it
requires, as a status without text does. `expectedTimeModified` is the `timeModified`
the caller last saw; when the stored item is newer, nothing is written.

Given one end of a time block, the other takes the same instant. A journal day another
entry of the workspace has is refused with `409 journal_day_taken`, and
`POST /api/items/journal` combines the item into that entry. A subcategory that does
not belong to the category is cleared, not refused. An item has one workspace, and
relationship ids must belong to it. A new item needs no category. There is no `type`
field. See `docs/db/item-taxonomy.md`.

`ItemRecord` returns `id`, `uid`, `workspaceId`, nullable `category` and `subcategory`
references, status and tag references, `description`, the time block, the journal day,
due and reminder dates, and creation and modification timestamps.

The trash lists pages of 200, newest first. `hasMore` says older entries remain; ask
for them with `before` set to the last id of the page. Entries older than
`retentionDays` are removed before each listing and on each deletion.

A create or update is stored without waiting for the embedding provider; the embedding
is written after the response, or by maintenance when the provider fails. Search ranks
query embeddings against item description embeddings and returns only items with
text. Maintenance modes are `missing` and `stale`. Search does not repair embeddings.

## Errors

These routes, `/api/item-groups`, and the shared routes below answer with
`Cache-Control: no-store`. An error body is `{ error, code }`: `error` is a sentence
for a person and `code` is for a program.

| Code                  | Status | Meaning                                                       |
| --------------------- | ------ | ------------------------------------------------------------- |
| `invalid_request`     | 400    | The request is malformed or refused by a validation rule.     |
| `content_required`    | 400    | The item would hold no content.                               |
| `requirement_missing` | 400    | A state would lack a capability it requires.                  |
| `unauthenticated`     | 401    | No valid session or token.                                    |
| `not_found`           | 404    | The user has no such record.                                  |
| `conflict`            | 409    | A label, uid, or identifier is taken, or the target changed.  |
| `item_changed`        | 409    | The stored item is newer; the body also carries `item`.       |
| `journal_day_taken`   | 409    | Another entry of the workspace has that day.                  |
| `search_unavailable`  | 503    | The embedding provider failed or is not configured.           |
| `unavailable`         | 503    | The database is unavailable.                                  |
| `internal`            | 500    | A server fault. The message is generic; the detail is logged. |

## Shared routes

`/api/bootstrap` loads the user, workspaces, and active workspace's items,
categories, statuses, and tags. `/api/session` reads the user and updates
preferences; `/api/workspaces`, `/api/categories`, `/api/statuses`, and `/api/tags`
manage the corresponding workspace-owned structures.

`POST /api/categories` with a `categoryId` creates a subcategory of that category and
returns `{ category, subcategory }`, where `category` is the refreshed parent. Category
records nest their `subcategories`.

## Portable backup and restore

Both methods use `/api/backup`, authenticated by the same cookie or bearer token.
GET downloads `jot-new-backup-YYYY-MM-DD.json`, always in the current version. POST takes
the entire JSON file, without another wrapper, and requires a permanent account.
Success returns `{ itemsImported, itemsSkipped }`.

The envelope's stable format is `jot.new-user-backup`. Version 5 nests
`subcategories` under each category, stores one `category` and `subcategory` per item,
and carries each item's time block and journal day. Import also accepts version 4,
which has no journal days, version 3, which has no time blocks either, version 2's list of categories per item, keeping the first, and version 1's
`workspaces[].notes`. Relationships use workspace-local labels. Files preserve nullable
text, dates, timestamps, empty workspaces, unused vocabulary, and preferences;
they exclude credentials, account identity, vectors, and browser draft/cache state.
Unknown versions, invalid references, unsafe object keys, excessive nesting, more
than 100,000 aggregate records, or files above 50 MiB are rejected.

Export uses a repeatable-read read-only snapshot. Restore validates the complete
file and stages/merges it within one transaction and one Postgres client. Existing
destination items are never overwritten. Matching workspace and vocabulary labels
combine. Exact duplicate multiplicities remain stable on repeated import; changed
versions are added alongside existing items. Preference leaves from the backup
win while account-only keys survive. Restore needs no Jina connection; missing
vectors can be repaired later through embedding maintenance.

Backup answers use `Cache-Control: no-store` and the same `{ error, code }` body. Invalid content
returns `400`, unauthenticated identity `401`, anonymous restore destination `403`,
oversized content `413`, incorrect content type `415`, unavailable database `503`, and
unexpected failures `500`. SQL and credentials are not exposed in error responses.

## Verification

Use `pnpm run db:verify` on an isolated database, the item database regression
suite, and `pnpm run release:notes:prepare`. See
[the item-core design](../../../docs/db/item-core.md) for the item domain.
