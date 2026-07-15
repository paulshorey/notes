# Database-First Monorepo Architecture

This monorepo uses database-first contracts so the notes apps can share the
same schema truth.

## Packages

- `@lib/db-notes` for `DB_NOTES_URL`

Each package contains:

- `migrations/` - canonical schema history
- `schema/current.sql` - generated snapshot
- `queries/` - language-agnostic SQL contracts
- `generated/` - derived language outputs (TypeScript, Python, C#, R)

## Current app usage

- `apps/notes-next` uses `@lib/db-notes/services/notes-app` in its API
  routes.
- `apps/notes-android` validates its client-facing models against the generated
  Notes contract from `@lib/db-notes`.

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
