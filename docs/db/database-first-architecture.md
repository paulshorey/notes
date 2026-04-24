# Database-First Monorepo Architecture

This monorepo uses database-first contracts so the marketing apps can share the
same schema truth.

## Packages

- `@lib/db-marketing` for `MARKETING_DB_URL`

Each package contains:

- `migrations/` - canonical schema history
- `schema/current.sql` - generated snapshot
- `queries/` - language-agnostic SQL contracts
- `generated/` - derived language outputs (TypeScript, Python, C#, R)

## Current app usage

- `apps/notes-next` uses `@lib/db-marketing/services/notes-app` in its API
  routes.
- `apps/notes-android` validates its client-facing models against the generated
  Notes contract from `@lib/db-marketing`.
- `apps/eighthbrain-next` should stay independent from the Notes DB package and
  Notes migration flow.

## Migration policy

- Use forward-only migrations with immutable timestamped filenames.
- Never edit an applied migration.
- Regenerate schema snapshots and generated language artifacts in CI.

## Workflow guide

Use `docs/db/management-playbook.md` for migration operations:

- first-time baseline on existing DBs
- adding/editing columns
- adding tables
- regenerating TypeScript schema types
