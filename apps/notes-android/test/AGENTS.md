# `test`

TypeScript-side adapter test entrypoint for Notes API compatibility checks.

## File map

- `notes-api-adapter.test.ts` - registers the shared `@lib/db-marketing` notes adapter suite against an Express app import at `../server/src/app`.

## Non-obvious rules

- This folder is not Android instrumentation coverage; it is Node/TypeScript test wiring.
- The current import target points at `../server/src/app`, but this package does not currently contain a `server/` directory. Treat that path as suspicious and verify the intended source before relying on the test.
- If these tests are revived or fixed, keep them aligned with the same shared Notes contract used by `notes-next`.

## Maintenance

Keep this file up to date after major changes in `apps/notes-android/test`. Edit it when tests move, are removed, or start targeting a different adapter surface.
