# Notes Environments and Railway Runbook

Use this runbook when the Notes UI, Next.js API, PostgreSQL schema, or Railway
deployment disagree. The fastest first command from the repository root is:

```bash
pnpm run diagnose:notes
```

It is read-only. It reports the current revision, PR checks, sanitized database
target, connection-pool settings, `/api/health`, required relations, migration
ledger, and Railway CLI linkage. It never applies migrations or prints database
credentials.

## Environment matrix

| Environment            | App and API                                                                          | Database                                                                                                                            | Lifecycle                                                         | Migration owner                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Local laptop           | `http://localhost:3000`; UI and `/api/*` are served by the same `notes-next` process | `DB_NOTES_URL` from the process, then `apps/notes-next/.env.local` or `.env`; this may be a persistent Railway development database | App process is disposable; the configured database usually is not | Developer runs `pnpm run db:migrate` intentionally                                       |
| Cursor Cloud           | `notes-next` runs inside the cloud workspace                                         | `.cursor/environment.json` provides local socket URLs for throwaway `notes` and `notes_test` PostgreSQL 17 databases                | Databases belong to the cloud workspace and start empty           | Run `pnpm run db:migrate` before app or DB work                                          |
| Railway PR preview     | Preview URL created by the Railway GitHub deployment check                           | Railway injects `DB_NOTES_URL`; confirm in Railway that the preview references the intended preview database rather than production | Preview app and, when configured, its database are temporary      | Railway `preDeployCommand` applies pending migrations before the preview starts          |
| Railway production     | Production Railway domain; UI and API deploy together                                | Production `DB_NOTES_URL`, injected by Railway                                                                                      | Persistent production data                                        | Railway `preDeployCommand` applies pending migrations before the release becomes healthy |
| GitHub DB Contracts CI | No user-facing app                                                                   | Fresh PostgreSQL 17 service container                                                                                               | Destroyed after the workflow                                      | Workflow runs migrations and contract verification against the fresh database            |

The Android app never connects to PostgreSQL directly. It consumes the deployed
`notes-next` API and validates against the generated Notes app contract.

## Configuration sources

`@lib/db-notes` owns the Notes schema, migration runner, generated contracts,
and runtime database pool. `apps/notes-next` owns the HTTP API and web UI.

Database configuration precedence for local diagnosis is:

1. exported `DB_NOTES_URL`
2. `apps/notes-next/.env.local`
3. `apps/notes-next/.env`

Do not paste a complete connection string into an issue, PR, chat, terminal
transcript, or screenshot. A PostgreSQL URL contains a password. Share only the
host, port, database name, SSL mode, and whether the connection succeeds.

The runtime pool defaults are deliberately conservative for Railway's public
PostgreSQL proxy:

| Variable                        | Default | Meaning                                                              |
| ------------------------------- | ------: | -------------------------------------------------------------------- |
| `PG_POOL_MAX`                   |     `1` | Maximum process-wide PostgreSQL connections                          |
| `PG_IDLE_TIMEOUT_MS`            |     `0` | Keep the established connection instead of closing it between bursts |
| `PG_CONNECTION_TIMEOUT_MS`      | `10000` | Initial connection timeout                                           |
| `PG_KEEPALIVE_INITIAL_DELAY_MS` | `10000` | TCP keepalive delay                                                  |

Increase `PG_POOL_MAX` only after confirming that the target database/proxy can
reliably accept the extra concurrent connections.

## Local development

From the repository root:

```bash
pnpm run deps:install -- notes-next...
pnpm run db:migrate
pnpm run dev:app
```

In another terminal:

```bash
pnpm run diagnose:notes
```

The default health check is `http://localhost:3000/api/health`. To inspect a
preview or production deployment instead:

```bash
pnpm run diagnose:notes -- --base-url https://DEPLOYMENT_DOMAIN
```

This still diagnoses the database configured on the machine running the
command; it cannot read the deployment's secret `DB_NOTES_URL`. The remote
health response confirms whether that deployment can reach its own database
and minimum schema.

## Railway deployment contract

The root `railway.json` and `apps/notes-next/railway.json` intentionally define
the same lifecycle:

1. build with `pnpm --filter notes-next build`
2. run `pnpm --filter @lib/db-notes db:migrate` as `preDeployCommand`
3. start with `pnpm --filter notes-next start`
4. require `GET /api/health` to pass before accepting the release

Keep the two Railway files synchronized. A migration failure blocks activation.
The health route also rejects a database that is reachable but missing the
workspace-era tables.

Before a production merge or manual deploy:

```bash
pnpm run release:notes:prepare
pnpm run diagnose:notes
```

Then verify the Railway deployment check and open its logs. The app must show a
successful pre-deploy migration, successful start, and HTTP 200 health check.
Do not manually run a production migration just because deployment is failing;
first establish which database the failing service references and whether its
migration ledger is behind.

## Failure isolation

Follow these boundaries in order:

1. **Revision:** confirm the branch, commit SHA, and PR deployment check. A green
   deploy for an older SHA does not test the current code.
2. **Process:** call `/api/health`. No response means the server, domain, port,
   or deploy is unavailable before application logic runs.
3. **Database connection:** a health response with
   `code: DATABASE_UNAVAILABLE` means the Next.js process cannot establish or
   retain its PostgreSQL connection.
4. **Schema:** `code: DATABASE_SCHEMA_OUTDATED` means the database is reachable
   but required relations are absent. Compare the migration ledger before any
   write.
5. **Authentication:** a healthy service plus `401` from `/api/bootstrap` means
   the request lacks a valid web session or Android bearer token.
6. **Request contract:** a `400` from `/api/notes` is an application validation
   failure. Read the JSON response body and verify workspace/category/status/tag
   IDs all belong to the active workspace.
7. **Persistence:** confirm writes in PostgreSQL. The UI and `localStorage` can
   display a note that never reached the server.

For a browser reproduction, keep the local dev terminal visible, inspect the
Network response body, and clear local storage before using a reload as proof of
persistence.

## Migration safety

These commands write to the selected database:

```bash
pnpm run db:migrate
pnpm run db:verify
```

`db:verify` is not a passive check: it starts by applying migrations and then
regenerates local contract artifacts. Use `pnpm run diagnose:notes` when the
goal is only to compare the target schema and migration ledger.

On a shared development database, the ledger may contain migrations from other
branches that are absent from the current checkout. The diagnostic reports this
"database ahead" state as a warning. A repository migration that is pending or
has a different checksum is a failure and must be understood before deployment.

Use `db:migrate:baseline` only for a legacy database that already contains the
baseline schema but has never been tracked. A fresh database always uses the
normal migration command.

## Logs and optional tooling

- Local Next.js failures: terminal running `pnpm run dev:app`
- CI and preview status: `gh pr checks` and the linked check details
- Railway build, pre-deploy, runtime, and health logs: Railway deployment page
- Railway CLI, if installed and authenticated: `railway status` and
  `railway logs`

A Railway MCP server can be a convenient interface to the same project, but it
is optional. This checked-in runbook, the Railway config, migration history, and
read-only diagnostic remain the source of truth for humans and future agents.
