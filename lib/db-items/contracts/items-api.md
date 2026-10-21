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

`ItemInput` contains `workspaceId`, `categoryIds`, nullable `statusId`, `tagIds`,
nullable `description`, `timeDue`, and `timeRemind`. The HTTP parser accepts
omitted text as null. The current text capture form requires nonblank text.
`ItemRecord` returns `id`, `workspaceId`, category/status/tag references,
`description`, due/reminder dates, and creation/modification timestamps. An item
has one workspace; relationship IDs must belong to that workspace. A new item
can have zero category links. No exclusive `type` field is introduced.

Search ranks query embeddings against item description embeddings. Maintenance
modes are `missing` and `stale`. Search does not implicitly repair embeddings.
Textless items persist without requiring an embedding-provider call.

## Shared routes and older clients

`/api/bootstrap` loads the user, workspaces, and active workspace's items,
categories, statuses, and tags. `/api/session` reads the user and updates
preferences; `/api/workspaces`, `/api/categories`, `/api/statuses`, and `/api/tags`
manage the corresponding workspace-owned structures.

The new client sends `X-Items-Contract: 1` on shared routes. Without that header,
responses also include legacy field aliases (`notes`, `noteCount`, and import
counts) for older loaded clients. `/api/notes`, `/api/notes/search`, and
`/api/notes/maintenance/embeddings` remain thin authenticated facades that translate
old `note`/`noteId` payloads into the same item service and return old field names.
Preferences and authored text are never mechanically rewritten.

## Portable backup and restore

Both methods use `/api/backup`, authenticated by the same cookie or bearer token.
GET downloads `jot-new-backup-YYYY-MM-DD.json`. Canonical callers send the item
contract header and receive version 2; older clients receive version 1. POST takes
the entire JSON file, without another wrapper, and requires a permanent account.
Success returns `{ itemsImported, itemsSkipped }` with legacy aliases when needed.

The envelope's stable format is `jot.new-user-backup`. Version 2 contains
`workspaces[].items`; import also accepts version 1's `workspaces[].notes` and
normalizes it. Relationships use workspace-local labels. Files preserve nullable
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
