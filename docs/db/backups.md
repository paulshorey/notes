# Notes database backups and refreshes

Notes uses separate PostgreSQL databases on Railway for development and
production. Verify the source and destination endpoints before using
administrative credentials. See [connection checks](./connect.md).

## Production backups

Use [Railway's scheduled backups](https://docs.railway.com/volumes/backups) for
the production Postgres service. Railway volume restores are scoped to the same
project and environment. For a portable copy, use the
[Notes backup scripts](../../scripts/README.md#full-copy) to export schema and
data. Store the SQL files privately and test restores in a disposable database.
They can contain note content and authentication data.

## Refresh development from production

1. Verify both targets and compare the table layouts and migration ledgers.
   Apply any required development schema migrations first.
2. Back up development before replacing its data. Restore the production
   export into a private, disposable database. Clear API tokens and password
   hashes, and sanitize personal data and private note content before preparing
   the development snapshot.
3. Make a data-only dump from the prepared snapshot and rehearse its restore.
   Follow the [table selection instructions](../../scripts/README.md#flags-and-partial-copies).
   Use the same explicit list of application tables for dump and restore.
   Include the empty API-token table because it references the user table.
   Leave `schema_migrations_cursor` out of a data-only refresh.
4. Point `DB_ITEMS_URL` explicitly at development and run
   `scripts/db/items-restore-data.sh` with the reviewed dump and table list.
   The script truncates and reloads those tables in one transaction.
5. Compare row counts to the prepared snapshot, confirm the development
   migration ledger, and verify the development app can read and create items.
