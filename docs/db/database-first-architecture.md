# Database-First Monorepo Architecture

This monorepo uses database-first contracts so the Notes web app and its API
share the same schema truth.

## Packages

- `@lib/db-items` for `DB_ITEMS_URL` (`DB_NOTES_URL` remains a deployment fallback)

Each package contains:

- `migrations/` - canonical schema history
- `schema/current.sql` - generated snapshot
- `queries/` - language-agnostic SQL contracts
- `generated/` - derived TypeScript types and JSON contracts/schema metadata

## Current app usage

- `apps/notes-next` uses `@lib/db-items/services/items-app` in its API
  routes.

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
