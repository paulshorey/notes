# @lib/db-items

The workspace-owned item domain for this repository. The text-focused web app
presents items with text as notes. This package owns schema history, generated
contracts, shared Postgres access, item services, and embedding logic.

See [the item core design and rollout](../../docs/db/item-core.md) for the domain
boundary and compatibility retained during the rename from `@lib/db-notes`.

## Environment

Set `DB_ITEMS_URL` for the intended database. Existing `DB_NOTES_URL` remains a
fallback during rollout. Tests require an explicit `DB_ITEMS_TEST_URL` (or legacy
`DB_NOTES_TEST_URL`); they never infer a target from the runtime URL.

Schema snapshot and verification need local PostgreSQL clients of the same major
version as the server. CI uses PostgreSQL 17 with pgvector. The snapshot script
rejects mismatched client/server versions.

## Schema

- `user_v1` and `user_api_token_v1`: identity and authentication
- `user_workspace_v1`: user-owned workspaces
- `workspace_item_v1`: workspace-owned items, including nullable text and dates
- `workspace_category_v1`, `workspace_status_v1`, `workspace_tag_v1`: flat vocabulary
- `item_category_link_v1`, `item_tag_link_v1`: zero-or-more item relationships

Each item belongs to one workspace. Composite foreign keys reject relationships
across workspaces. `uncategorized` is display text for no category links; it is
never a default category row. There is no exclusive item type discriminator.

## Migration and verification commands

From the repository root, against an isolated development database:

```bash
pnpm run db:migrate
pnpm run db:verify
DB_ITEMS_TEST_URL=postgresql://... pnpm --filter @lib/db-items test
```

`db:verify` runs migrations, checks structural assertions, regenerates schema and
contract artifacts, and checks them against Git. It is not read-only. Stage new
artifacts before verification on a feature branch so differences caused by
regeneration are visible. Never run it against a deployed database incidentally.

A legacy database that already contains the baseline schema but has no migration
ledger needs `pnpm run db:migrate:baseline` once before normal migration. Fresh
empty databases and normal releases do not need baselining.

Create a forward migration with:

```bash
pnpm --filter @lib/db-items db:migration:new -- add_item_property
```

Do not edit previously applied SQL or add transaction wrappers: the runner wraps
each migration in its own transaction. Update `scripts/verify-contract.mjs` with
each schema change and regenerate derived artifacts using:

```bash
pnpm --filter @lib/db-items db:sync
```

Commit `schema/current.sql`, `generated/typescript/db-types.ts`,
`generated/contracts/db-schema.json`, and `generated/contracts/items-app.json`
alongside the migration and canonical contracts. Generated types include physical
base tables; compatibility views are deliberately excluded.

## Deployments and previews

Run `pnpm run release:notes:prepare` before deployment. Railway's committed
pre-deploy command applies tracked migrations before the web release becomes
healthy. Manual migration to a deployed target needs explicit task authorization
and confirmation of the actual database target. Embedding regeneration is a
separate repair operation when search data needs it.

A preview environment does not by itself prove database isolation. Inspect its
effective connection reference before testing migrations; existing previews can
share a development database. This rename keeps old table names as updatable
views so old and new server builds operate on the same physical rows. Remove
those compatibility objects only after old writers have drained.

Operational details: [environment matrix](../../docs/operations/notes-environments.md)
and [Railway IaC](../../.railway/README.md).
