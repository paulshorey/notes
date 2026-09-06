# Scripts

Repo-local utilities. This document covers the Notes database backup and restore scripts in `scripts/db/`.

## Prerequisites

Set the database connection string before running any script:

```bash
export DB_NOTES_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE'
```

Scripts use `pg_dump` and `psql` from the Postgres client version required by `@lib/db-notes` (resolved via `scripts/check-postgres-client-version.sh`). Run commands from the repo root.

Backup files are written under `scripts/db/backups/` by default (that directory is gitignored).

## Scripts

| Script                    | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `notes-backup-schema.sh`  | Dump table definitions (DDL only, no rows)                      |
| `notes-backup-data.sh`    | Dump row data only (no DDL)                                     |
| `notes-restore-schema.sh` | Drop selected tables, then recreate schema from a schema backup |
| `notes-restore-data.sh`   | Truncate selected tables, then load rows from a data backup     |

Shared defaults and helpers live in `scripts/db/common.sh`.

### Default tables

Unless you pass `-t`, all four scripts target the Notes app tables:

- `user_v1`
- `user_api_token_v1`
- `user_note_v1`
- `user_note_tag_v1`
- `user_note_tag_link_v1`
- `user_taxonomy_level_v1`
- `user_taxonomy_v1`
- `schema_migrations_cursor`

Other tables in the database are never touched.

## Flags

### `-t` / `--table` (backup and restore)

Limits which **public** tables are included. Repeat the flag for each table:

```bash
./scripts/db/notes-backup-schema.sh -t user_v1 -t user_note_v1
```

- **Backup:** only the named tables are dumped.
- **Restore:** only the named tables are dropped (schema restore) or truncated (data restore).

Use the **same** `-t` list for a backup and its matching restore. If you customize tables for the schema step, use the same list for the data step.

Omit `-t` to use the default Notes table set above.

### `-y` / `--yes` (restore only)

Skips the interactive confirmation prompt. Restore scripts normally ask you to type `YES` before changing the database.

Use `-y` in scripts, CI, or any non-interactive shell (when stdin is not a terminal, restore fails without `-y`).

```bash
./scripts/db/notes-restore-schema.sh -y ./scripts/db/backups/notes-schema-20260527-120000.sql
```

Backup scripts do not support `-y`; they only read from the database.

### `-h` / `--help`

Prints usage for any script.

## Two-step backup and restore

Always run schema and data as separate steps: schema first, then data.

### Backup

```bash
export DB_NOTES_URL='postgresql://...'

./scripts/db/notes-backup-schema.sh
# -> scripts/db/backups/notes-schema-YYYYMMDD-HHMMSS.sql

./scripts/db/notes-backup-data.sh
# -> scripts/db/backups/notes-data-YYYYMMDD-HHMMSS.sql
```

Optional: write to a specific path:

```bash
./scripts/db/notes-backup-schema.sh ./my-schema.sql
./scripts/db/notes-backup-data.sh ./my-data.sql
```

### Restore

Restore onto a database that should receive a full copy of those tables. **Schema restore drops tables** (and dependent objects on them via `CASCADE`). **Data restore truncates tables** before loading rows.

```bash
export DB_NOTES_URL='postgresql://...'

./scripts/db/notes-restore-schema.sh -y ./scripts/db/backups/notes-schema-YYYYMMDD-HHMMSS.sql
./scripts/db/notes-restore-data.sh -y ./scripts/db/backups/notes-data-YYYYMMDD-HHMMSS.sql
```

Without `-y`, each restore script prompts: `Type YES to continue:`.

### Partial table set example

```bash
TABLES=(-t user_v1 -t user_note_v1)

./scripts/db/notes-backup-schema.sh "${TABLES[@]}"
./scripts/db/notes-backup-data.sh "${TABLES[@]}"

./scripts/db/notes-restore-schema.sh -y "${TABLES[@]}" ./path/to/notes-schema-....sql
./scripts/db/notes-restore-data.sh -y "${TABLES[@]}" ./path/to/notes-data-....sql
```

## Safety notes

- Point `DB_NOTES_URL` at the database you intend to modify. There is no dry-run mode.
- Schema restore **drops** the selected tables; data restore **truncates** them. Other tables in the same database are unchanged.
- After schema restore, tables are empty until you run data restore.
- Keep schema and data backup files paired; they are not interchangeable.
