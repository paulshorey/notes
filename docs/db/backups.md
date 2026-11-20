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
2. Restore the production export into a private, disposable database. Clear
   API tokens and password hashes, and sanitize personal data and private note
   content before preparing the development snapshot.
3. Make a data-only dump from the prepared snapshot and rehearse its restore.
   Follow the [table selection instructions](../../scripts/README.md#flags-and-partial-copies).
   Use the same explicit list of application tables for dump and restore.
   Include the empty API-token table because it references the user table.
   Leave `schema_migrations_cursor` out of a data-only refresh.
4. If the development app is running, fence off existing sessions before
   importing production user IDs. Session JWTs and anonymous merge tokens carry
   database user IDs, which can refer to different accounts after the refresh.
   Coordinate the maintenance window with active development users so queued
   edits sync and in-flight writes finish. Resolve failed writes before
   proceeding. With authorization, stop only the Railway development web
   deployment and verify it is offline. Rotate its development-only
   `AUTH_SECRET` with `railway variable set AUTH_SECRET --stdin --skip-deploys`.
   Keep the web app offline through the restore.
5. Reverify the development database endpoint and back it up while the web app
   is offline. Point `DB_ITEMS_URL` explicitly at development and run
   `scripts/db/items-restore-data.sh` with the reviewed dump and table list.
   The script truncates and reloads those tables in one transaction.
6. Compare row counts to the prepared snapshot and confirm the development
   migration ledger. Redeploy the development web app from its configured source.
   Verify the new deployment is serving and use fresh development sessions to
   confirm that the app can read and create items.
