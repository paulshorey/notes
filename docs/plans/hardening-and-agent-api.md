# Plan: hardening and the agent API

This plan lists the work that makes the item API and the web client more reliable, and
the API easier for scripts and agents to use. It sits beside
[item content and relations](item-content-and-relations.md), which sets the order of
the content types. Each numbered item is one pull request and leaves the app working.

Do section 1 before the lists phase of that plan: lists add a batch route and tree
fields, and both depend on the client writing through one tested path.

## 1. Client writes

The web client writes items from five places, and the code that decides what a save
does is inside React hooks that no test imports.

1. **Move the save engine out of its hook.**
   - Change: turn `saveEntry`, the exit keepalive, and the conflict rules of
     `src/workspace/useItemSaveEngine.ts` into a plain module that takes its
     dependencies (fetch, the entry store, a clock) as arguments. The hook becomes the
     wiring.
   - Tests, with a fake fetch:
     - a create answered `200` is followed by an update;
     - a `409` continues when the stored item holds what the entry last saved, what
       the page sent as it was hidden, or what is being sent, and stops otherwise;
     - a save of A in flight, B sent as the page hides, A acknowledged first, then C
       saved;
     - an entry that left the ring with a failed save, reopened, while another tab
       edited the item;
     - a `404` creates the item again under the entry's uid.
2. **One write function for every caller.**
   - Change: list actions (`patchStoredItem`), quick-add, and the time form
     (`handleSaveTimeBlock`) in `useTaxonomyActions.ts` call the engine with a field
     patch and the version they read. Remove their own request code.
   - Done when: `grep -rn '"/api/items"' apps/notes-next/src` finds the engine and the
     trash, journal, and search callers only.
3. **Say what is discarded when the active workspace is deleted.**
   - Change: `handleRequestDeleteWorkspace` counts open entries that hold text and were
     never saved, and the review dialog lists them with the items.

## 2. Embeddings

1. **Run maintenance on a schedule.**
   - Problem: an item whose embedding failed stays out of search until something calls
     `POST /api/items/maintenance/embeddings`, and nothing does.
   - Change: `scripts/regenerate-embeddings.mjs` regenerates every embedding. Give it
     a `--missing` flag that selects only rows with no embedding or an outdated model,
     and add a Railway cron service that runs it for every user. Declare the service in
     `.railway/railway.ts`.
   - Done when: an item saved while the provider key is invalid is embedded within one
     cron interval after the key is restored.
2. **Drop label embeddings, or use them.**
   - Problem: `category_embedding` and `tag_embedding` are written by maintenance and
     read by nothing; search ranks item text only.
   - Change, if dropped: a migration removes both columns, their HNSW indexes, and the
     label branches of `maintainItemEmbeddingsForItemsApp` and
     `scripts/regenerate-embeddings.mjs`. Update `stored-capabilities.ts`,
     `verify-contract.mjs`, and `docs/search/embedding.md`.

## 3. API for agents

1. **Return `kinds` on every item.** Add `kinds: ItemKindKey[]` to `ItemRecord`,
   filled by `itemKinds` in `mapItem` (`sql/item/shared.ts`). A caller then needs the
   model only to plan a write.
2. **Address an item by uid.** Add `GET`, `PATCH`, and `DELETE /api/items/[uid]`
   beside the body-addressed routes, through the same `route()` wrapper. `GET` answers
   one item, which no route does today.
3. **Accept labels.** `ItemInput` and `ItemPatch` take `category`, `subcategory`,
   `status`, and `tags` as labels as well as ids. A label that does not exist is
   created, as `POST /api/categories` and `POST /api/tags` already do.
4. **Filter and page the list.** `GET /api/items` takes `kind`, `category`, `status`,
   `tag`, `modifiedSince`, `limit`, and a cursor shaped like the trash's. Without
   them it answers the whole workspace, which the web client relies on.
5. **Batch writes.** `POST /api/items/batch` applies several creates, patches, and
   deletes in one transaction. This is the batch route the lists phase needs.
6. **Describe the API as data.** Generate an OpenAPI document from
   `contracts/items-app.ts` next to `item-model.json`, and serve it at
   `GET /api/openapi.json`.
7. **Tokens.** `user_api_token_v1` gains a name, an expiry, and a last-used time.
   `POST /api/auth/token` accepts a name and a lifetime, and `GET /api/auth/token`
   lists the user's tokens without their secrets.

## 4. Trash and restore

1. **Restore a workspace's statuses in order.** A trash entry keeps its status by
   label only, so a restore after the workspace was deleted appends each status at the
   end. Store the position beside the label in the trash entry and write it back when
   the status is created.
2. **Restore a whole deleted workspace.** Group the trash entries of one workspace
   deletion and offer one action that restores them together.

## 5. Structure of the web client

Apply these as rules of the redesign, not as a separate refactor.

- A component reads the slice of `workspaceStore` or `itemsAppStore` it needs through a
  selector. `useItemsWorkspace()` carries actions only, so typing does not re-render
  the header, the sidebar, and the lists.
- `ResultsColumn.tsx` is split into its accordions, and `TimeView.tsx` into its
  ranges and its form, one file each.
- A view declares its editor parts and its quick-add context in
  `src/views/registry.ts`; `TextCaptureForm` and `useTaxonomyActions` hold no branch
  on a view's kind.

## 6. Operations and security

Each is its own task.

- `POST /api/embeddings/debug` requires a session.
- Rate limits on anonymous sign-in, credential sign-in, token issue, search, and
  embedding maintenance.
- A size limit on JSON request bodies, and a length limit on passwords before hashing.
- Response headers: a content security policy, `frame-ancestors`, HSTS, `nosniff`.
- Error reporting for the `console.error` calls in the route handlers.
- `PG_POOL_MAX` above one, with the "concurrent" tests run on a pool that allows it.
- Lint in CI as a failing check, and the checks run on a push to `prod`.
- A scheduled `db:anon:cleanup`.

## 7. Small removals

- The client code that handles `workspaceRemoved: true` from a group action, which
  the server no longer answers.
- The `notesUserId` read in `src/lib/sessionIdentity.ts`, once every session cookie
  has been reissued. A cookie lasts 30 days.
- `apps/notes-next/stubs/fs.cjs` and its `turbopack.resolveAlias` entry, if a build
  passes without them.
- The "Open work" table in `docs/auth/login-signup.md`, checked row by row against the
  code.
- The port fallback in `scripts/agent-env-setup.sh` for a port the app does not use.
- `apps/notes-next/AGENTS.md`: move the saving lifecycle and group-action sections to
  `docs/`, and keep the rules an agent needs on every task.
