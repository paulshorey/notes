## notes-android test

This folder currently contains TypeScript-side Notes API adapter test wiring rather than Android instrumentation tests.

### Current status

- `notes-api-adapter.test.ts` registers the shared `@lib/db-marketing` adapter suite.
- The current file imports `../server/src/app`, but this package does not currently contain a `server/` directory.
- Verify the intended server entrypoint before relying on or expanding this test.

### When updating tests

- Keep them aligned with the shared Notes contract in `@lib/db-marketing`.
- If the adapter target changes, update both the test file and `AGENTS.md` in this folder.
