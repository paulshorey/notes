# Item API

`apps/notes-next` serves these authenticated routes over the canonical item
service. The current web UI edits text items and calls them notes.

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

| Route                                    | Request                         | Response                                |
| ---------------------------------------- | ------------------------------- | --------------------------------------- |
| `GET /api/items?workspaceId=...`         | Authorized workspace            | `{ items: ItemRecord[] }`               |
| `POST /api/items`                        | `{ item: ItemInput }`           | `201 { item: ItemRecord }`              |
| `PATCH /api/items`                       | `{ itemId, item: ItemInput }`   | `{ item: ItemRecord }`                  |
| `DELETE /api/items`                      | `{ itemId }`                    | `{ ok: true }`                          |
| `POST /api/items/search`                 | `{ workspaceId, query, limit }` | `{ results: [{ item, similarity }] }`   |
| `POST /api/items/maintenance/embeddings` | `{ mode, limit }`               | `{ mode, processed, updated, hasMore }` |

`ItemInput` contains `workspaceId`, nullable `categoryId` and `subcategoryId`, nullable
`statusId`, `tagIds`, nullable `description`, `timeDue`, and `timeRemind`. A subcategory
that does not belong to the category is cleared, not refused. The HTTP parser accepts
omitted text as null. `POST` and `PATCH` return `400` when the item would hold no
capability at all: text, a due or reminder date, or a status each suffice on their own
(`contracts/item-capabilities.ts`). Search returns only items with text.
`ItemRecord` returns `id`, `workspaceId`, nullable `category` and `subcategory`
references, status and tag references, `description`, due/reminder dates, and
creation/modification timestamps. An item has one workspace; relationship IDs must
belong to that workspace. A new item needs no category. There is no `type` field.
See `docs/db/item-taxonomy.md`.

Search ranks query embeddings against item description embeddings. Maintenance
modes are `missing` and `stale`. Search does not implicitly repair embeddings.

## Shared routes and older clients

`/api/bootstrap` loads the user, workspaces, and active workspace's items,
categories, statuses, and tags. `/api/session` reads the user and updates
preferences; `/api/workspaces`, `/api/categories`, `/api/statuses`, and `/api/tags`
manage the corresponding workspace-owned structures.

`POST /api/categories` with a `categoryId` creates a subcategory of that category and
returns `{ category, subcategory }`, where `category` is the refreshed parent. Category
records nest their `subcategories`.

The client sends `X-Items-Contract: 2` on shared routes. A shared route with no
contract header also includes legacy field aliases (`notes`, `noteCount`, and import
counts) for older loaded clients. An item request that lists `categoryIds` without
`categoryId` returns `400` with a message to reload the page. `/api/notes`, `/api/notes/search`, and
`/api/notes/maintenance/embeddings` remain thin authenticated facades that translate
old `note`/`noteId` payloads into the same item service and return old field names.
Preferences and authored text are never mechanically rewritten.

## Portable backup and restore

Both methods use `/api/backup`, authenticated by the same cookie or bearer token.
GET downloads `jot-new-backup-YYYY-MM-DD.json`, always in the current version. POST takes
the entire JSON file, without another wrapper, and requires a permanent account.
Success returns `{ itemsImported, itemsSkipped }` with legacy aliases when needed.

The envelope's stable format is `jot.new-user-backup`. Version 3 nests
`subcategories` under each category and stores one `category` and `subcategory` per
item. Import also accepts version 2's list of categories per item, keeping the first,
and version 1's `workspaces[].notes`. Relationships use workspace-local labels. Files preserve nullable
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

Routes use `Cache-Control: no-store`. Invalid content returns `400`, unauthenticated
identity `401`, anonymous restore destination `403`, oversized content `413`,
incorrect content type `415`, unavailable database `503`, and unexpected failures
`500`. SQL and credentials are not exposed in error responses.

## Verification

Use `pnpm run db:verify` on an isolated database, the item database regression
suite, and `pnpm run release:notes:prepare`. Compatibility tests cover older HTTP
payloads, version-one backups, signed identity fields, and browser storage. See
[the item-core design](../../../docs/db/item-core.md) for the database rollout.
