# Railway Preview Deployments

This document describes how to configure PR-based preview deployments for `notes-next` and its PostgreSQL database on Railway.

## Architecture Overview

```
PR opened (changes to apps/notes-next/** or lib/db-marketing/**)
  │
  ├─► Railway creates ephemeral PR environment
  │     ├── notes-next service (built from PR branch)
  │     ├── PostgreSQL service (fresh empty instance)
  │     └── Unique public domain: pr-<id>.up.railway.app
  │
  ├─► Pre-deploy: migrations run against fresh PR database
  │
  └─► PR merged/closed → environment + all resources destroyed
```

Each PR environment is **fully isolated**: its own database, its own app instance, its own URL, its own private network. No production data is shared or at risk.

## Railway Dashboard Configuration

### Step 1: Enable PR Environments

1. Open the Railway project dashboard
2. Go to **Project Settings → Environments**
3. Toggle **Enable PR Environments** ON
4. Toggle **Enable Focused PR Environments** ON (recommended for monorepo)
5. Toggle **Enable Bot PR Environments** ON (allows AI agents like Claude, Copilot, Dependabot to trigger previews)

### Step 2: Ensure Railway-Provided Domain Exists

PR environments only auto-provision domains if the base environment's service uses a Railway-provided domain. If you only have custom domains:

1. Open the `notes-next` service in the production environment
2. Go to **Settings → Networking**
3. Click **Generate Domain** to add a Railway-provided domain (e.g. `marketing-apps-notes-next.up.railway.app`)
4. The custom domain can remain alongside it — the Railway domain just enables PR auto-provisioning

### Step 3: Verify PostgreSQL Service Configuration

The PR environment clones all services from the base environment, including database services. Ensure:

1. The PostgreSQL service in your base environment uses the `pgvector/pgvector:pg17-trixie` image (or Railway's built-in PostgreSQL plugin with pgvector extension)
2. The `MARKETING_DB_URL` variable on the `notes-next` service references the PostgreSQL service using Railway's template syntax:
   ```
   MARKETING_DB_URL=${{Postgres.DATABASE_URL}}
   ```
   This ensures each PR environment's app points to its own isolated PR database instance.

### Step 4: Watch Paths (Already Configured)

The `railway.json` already defines watch patterns:

```json
"watchPatterns": ["apps/notes-next/**", "lib/db-marketing/**"]
```

With **Focused PR Environments** enabled, Railway only deploys the `notes-next` service when files in those paths change. Other services in the project (if any) are skipped unless they depend on `notes-next` via variable references.

## Config-as-Code: `railway.json`

The `railway.json` file now includes a `pr` environment override that runs migrations automatically:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK",
    "buildCommand": "pnpm --filter notes-next build",
    "watchPatterns": ["apps/notes-next/**", "lib/db-marketing/**"]
  },
  "deploy": {
    "startCommand": "pnpm --filter notes-next start",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  },
  "environments": {
    "pr": {
      "deploy": {
        "preDeployCommand": [
          "/bin/sh -c \"cd lib/db-marketing && node scripts/migrate.mjs\""
        ],
        "restartPolicyMaxRetries": 3
      }
    }
  }
}
```

### How It Works

- **Production** (`main` branch): No `preDeployCommand` — migrations remain operator-driven as before.
- **PR environments**: The `preDeployCommand` runs after build but before the app container starts. It applies all migrations from `lib/db-marketing/migrations/` to the fresh PR database. Since the PR database starts empty, all migrations run from scratch — creating the full schema.
- **Private networking**: The pre-deploy command executes with access to the private network, so `MARKETING_DB_URL` (pointing to the PR's PostgreSQL service) is available.
- **Failure handling**: If the migration fails (non-zero exit), the deployment does not proceed, giving immediate feedback in the PR.

## How Database Preview Environments Work

### Do you need a new database for every PR?

**Yes — but Railway handles this automatically.** When PR Environments are enabled:

1. Railway clones the environment's service definitions (including the PostgreSQL service)
2. A fresh, empty PostgreSQL instance is provisioned for each PR
3. The `MARKETING_DB_URL` variable resolves to the new PR database (via Railway's `${{Postgres.DATABASE_URL}}` template)
4. The `preDeployCommand` runs migrations to set up the schema
5. The app starts against the fully-migrated PR database
6. When the PR is merged or closed, the database is destroyed

This means:
- **No shared staging database** — each PR is isolated
- **No data conflicts** between concurrent PRs
- **No manual cleanup** — Railway auto-destroys on PR close/merge
- **Cost-efficient** — billed per-minute only while the PR is open

### When does the database spin up?

With Focused PR Environments, the database (and app) only deploy when the PR contains changes to `apps/notes-next/**` or `lib/db-marketing/**`. PRs that only touch `apps/notes-android/` or documentation won't trigger a preview environment.

### Can we only spin up a database when migrations change?

Railway's Focused PR Environments work at the **service level**, not individual file level within a watch path. Since `notes-next` always needs a database to start (the `/api/health` endpoint checks DB connectivity), every PR environment for this service needs a database.

However, this is acceptable because:
- Railway PostgreSQL instances are lightweight and fast to provision (~5 seconds)
- Cost is minimal for review-duration usage
- The alternative (sharing a database) introduces schema conflicts between PRs

If you want to avoid spinning up environments for PRs that don't touch the app at all, the `watchPatterns` already handle this — only changes to `apps/notes-next/**` or `lib/db-marketing/**` trigger the preview.

## App-Database Sync

The app and database are always in sync because:

1. The PR database starts empty
2. The `preDeployCommand` runs all migrations from the PR branch's `lib/db-marketing/migrations/`
3. The app is built from the same PR branch
4. Both use the same commit — schema and code always match

This eliminates the production risk of "code expects column X but migration hasn't run yet."

## Cost Considerations

Railway charges per-minute for resource consumption:
- **PostgreSQL**: Small instances are very cheap during review (~$0.01-0.05/day for idle databases)
- **App compute**: Only runs while the PR is open
- **Total per-PR cost**: Typically < $1 for a multi-day review cycle

Both services are destroyed immediately when the PR closes.

## Environment Variables for PR Environments

Railway PR environments inherit variables from the base environment. Key variables:

| Variable | PR Behavior |
|----------|-------------|
| `MARKETING_DB_URL` | Auto-resolves to PR's PostgreSQL instance (via `${{Postgres.DATABASE_URL}}`) |
| `JINA_API_KEY` | Inherited from base environment — semantic search works in previews |
| `RAILWAY_PUBLIC_DOMAIN` | Auto-set to the PR's unique domain |
| `RAILWAY_ENVIRONMENT_NAME` | Set to the PR environment name (e.g. `pr-123`) |

Note: Railway does not currently support custom variable overrides for PR environments. If you need different values (e.g. reduced pool size), consider checking `RAILWAY_ENVIRONMENT_NAME` at runtime.

## Troubleshooting

### PR environment doesn't get a domain

Ensure the base environment's `notes-next` service has a Railway-provided domain (not just a custom domain). See Step 2.

### Pre-deploy command fails with "MARKETING_DB_URL not set"

Ensure `MARKETING_DB_URL` is defined using Railway's template syntax: `${{Postgres.DATABASE_URL}}`. Static connection strings won't resolve in PR environments.

### Migrations fail because pg/pgvector isn't available

Ensure the PostgreSQL service uses `pgvector/pgvector:pg17-trixie` or has the `vector` extension pre-enabled. The baseline migration creates the `vector` extension.

### Empty pre-deploy logs

The `/bin/sh -c "..."` wrapper in the `preDeployCommand` ensures error messages are captured. If logs are still empty, check that `node` is available in the built image (Railpack with pnpm should include it).

## Comparison with Manual Migration Workflow

| Aspect | Production (current) | PR Preview (new) |
|--------|---------------------|------------------|
| Database | Persistent, production data | Fresh, empty, ephemeral |
| Migrations | Manual operator step | Automatic via preDeployCommand |
| Cleanup | N/A | Auto-destroyed on PR close |
| Domain | Custom domain | Auto-generated Railway subdomain |
| Cost | Always running | Only while PR is open |
| Data | Real user data | Empty (or add seed script) |

## Optional: Adding Seed Data

If reviewers need sample data in preview environments, create a seed script and add it to the pre-deploy command:

```json
"preDeployCommand": [
  "/bin/sh -c \"cd lib/db-marketing && node scripts/migrate.mjs && node scripts/seed-preview.mjs\""
]
```

## Related Files

- `/railway.json` — Railway config-as-code (primary)
- `/apps/notes-next/railway.json` — duplicate config (Railway may use either based on service settings)
- `/lib/db-marketing/scripts/migrate.mjs` — migration runner
- `/.github/workflows/db-contracts.yml` — CI verification (separate from deploy)
