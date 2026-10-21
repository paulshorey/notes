# Scripts

Repo-local utilities.

## AI agent environment

`scripts/agent-env-setup.sh` prepares a Linux agent VM with Node/pnpm,
PostgreSQL 17 + pgvector, dependencies, and migrated local throwaway databases.

```bash
bash scripts/agent-env-setup.sh
source .agent-env.sh
```

Cursor Cloud uses `cloud-agent-install.sh` / `cloud-agent-start.sh` through
`.cursor/environment.json`. See [agent environments](../docs/operations/agent-environment.md).

## Database backup and restore

The four scripts under `scripts/db/` operate on the item-service database.
They are administrative copies of physical data, including account rows, token
hashes, vectors, and the migration ledger. The web client's portable JSON backup
is a separate format and excludes credentials and vectors.

Set `DB_ITEMS_URL` explicitly for the intended source or destination.
`DB_NOTES_URL` remains a fallback for existing deployments. The tools select
`pg_dump` and `psql` of the server's major version through
`check-postgres-client-version.sh`. Run from the repository root.

| Script                    | Purpose                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `items-backup-schema.sh`  | Dump selected tables, their item compatibility views, and required item-schema dependencies |
| `items-backup-data.sh`    | Dump selected rows and owned sequence values from one consistent data snapshot              |
| `items-restore-schema.sh` | Replace selected tables and their item compatibility views in one transaction               |
| `items-restore-data.sh`   | Truncate and reload selected tables and sequence values in one transaction                  |

Defaults are defined in `scripts/db/common.sh`:

- `user_v1`, `user_api_token_v1`, `user_workspace_v1`
- `workspace_item_v1`
- `workspace_category_v1`, `workspace_status_v1`, `workspace_tag_v1`
- `item_category_link_v1`, `item_tag_link_v1`
- `schema_migrations_cursor`

Schema backups include the selected tables' legacy SQL compatibility views and,
when used by those tables, the pgvector extension declaration and the current
`apply_row_timestamps_v1()` definition. A fresh destination needs the pgvector
server extension files installed and a role allowed to create the extension.
Existing migrated destinations are also supported. Historical sequence names
such as `user_note_v1_id_seq` remain intentional rolling-server compatibility;
the dump preserves their ownership and values.

## Full copy

Produce both files from the same schema version; coordinate DDL changes while
creating a pair. Keep the source and destination URLs explicit:

```bash
export DB_ITEMS_URL='postgresql://.../source'
./scripts/db/items-backup-schema.sh ./items-schema.sql
./scripts/db/items-backup-data.sh ./items-data.sql

export DB_ITEMS_URL='postgresql://.../destination'
./scripts/db/items-restore-schema.sh -y ./items-schema.sql
./scripts/db/items-restore-data.sh -y ./items-data.sql
```

With no output path, backups go to ignored
`scripts/db/backups/items-{schema,data}-YYYYMMDD-HHMMSS.sql` files. The scripts
fail if any requested relation is missing, rather than silently making a partial
backup. Backup commands do not mutate the source database.

Each restore command first prepares its complete input, then runs it with
`psql -X --single-transaction` and `ON_ERROR_STOP`. A SQL failure rolls that
command back, including its initial drop or truncation. Schema and data restores
are **separate transactions**: a successful schema restore leaves empty tables
until the data restore succeeds. Use only the matching SQL files produced by
these tools; they are not portable JSON imports or a converter for old schemas.
Before changing the database, the tools also check that the file contains every
selected table in the appropriate DDL or COPY format. Empty files, mismatched
schema/data files, old table names, and incomplete table selections are rejected.

## Flags and partial copies

`-t TABLE` / `--table TABLE` is repeatable. Use the same list for backup and
restore. Identifier names are quoted, and missing names are rejected.

A custom restore must contain the full set of tables needed by its foreign keys.
The tools never use `CASCADE`: they refuse to truncate related unselected tables
or remove outside constraints/views. Known item compatibility views are handled
explicitly. An incomplete table set fails and leaves the target unchanged.

A leaf relationship table can be copied by itself when its referenced parent
rows already exist at the destination:

```bash
./scripts/db/items-backup-schema.sh -t item_tag_link_v1 ./items-tag-links-schema.sql
./scripts/db/items-backup-data.sh -t item_tag_link_v1 ./items-tag-links-data.sql
./scripts/db/items-restore-schema.sh -y -t item_tag_link_v1 ./items-tag-links-schema.sql
./scripts/db/items-restore-data.sh -y -t item_tag_link_v1 ./items-tag-links-data.sql
```

`-y` / `--yes` skips the restore confirmation. Without it, a terminal must supply
`YES`; noninteractive restores fail. `-h` / `--help` prints usage. Backup commands
never accept `-y` because they only read the database.

## Verification

`DB_ITEMS_TEST_URL=... pnpm --filter @lib/db-items test` includes real CLI
regressions. Those tests create disposable source and destination databases on
the explicit test cluster; the role needs database-creation privileges. They
verify canonical rows/relations, textless dated items, vectors, timestamps,
compatibility views, sequence continuation, failed-restore rollback, and partial
restore boundaries. The DB Contracts CI workflow also watches these scripts.
