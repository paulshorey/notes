# Connect to the Notes database

Notes runs on separate Railway Postgres services for [development and
production](../operations/notes-environments.md). On the shared workstation,
the database-query skill uses named targets:

```sh
~/.agents/bin/agents-sql check notes-dev
~/.agents/bin/agents-sql check notes-prod
```

Both checks report the sanitized endpoint and verify the read-only role. Use
`agents-sql query TARGET` for inspection and `agents-sql write TARGET` for
authorized Notes data changes.

For [schema migrations](./migrations.md) or [backup and restore](./backups.md),
set `DB_ITEMS_URL` explicitly from the intended service's private connection
settings. Use TLS for deployed connections and keep URLs out of logs, files
tracked by Git, and shell history. From a local machine use the service's
external endpoint. From the Railway application use its configured private
connection.
