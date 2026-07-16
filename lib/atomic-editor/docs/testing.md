# Testing

The test harness has four layers. Each catches a different class of regression,
and CI runs all four.

## Fast integration tests

`npm test` runs Vitest against Happy DOM. Use this layer for parsing,
decorations, editor state, and rendering contracts that do not depend on real
browser layout.

Markdown edge cases shared with the browser suite live in
`src/__tests__/fixtures/markdown-contracts.ts`. Add a case there when the same
input/output rule should be enforced in both environments.

## Deterministic browser tests

`npm run test:e2e:playwright` runs the specs under `tests/e2e` against
`demo/harness.html`. The fixture deliberately excludes the interactive demo's
controls and sample data, giving each test a fixed viewport, isolated editor,
and explicit load/focus/source APIs.

Chromium runs every spec. Firefox and WebKit run tests tagged `@smoke`, covering
mounting, rendering, editing, and read-only behavior. Failures retain a trace,
video, and screenshot in `test-results` and an HTML report in
`playwright-report`.

Use `npm run test:e2e:headed` to debug the Chromium suite interactively.

## Legacy browser probes

`npm run test:e2e:legacy` retains the broad probe suite in
`scripts/test-editor.mjs` during the migration. It covers long-document and
timing-sensitive behaviors including layout shift, scrolling, click freezing,
block decorations, raw-markdown copying, and parser progress.

`npm run test:e2e` runs the legacy and deterministic suites together. CI wraps
the command in a hard timeout so leaked browsers or servers cannot leave a job
running indefinitely.

## Published-package smoke test

`npm run test:package` creates the actual npm tarball, installs it in a clean
temporary consumer, imports the documented entry points and stylesheet, and
builds that consumer with Vite. This catches missing files, broken export maps,
and package-only module-resolution failures before publishing.

CI also runs `npm audit --audit-level=moderate`. Dependabot checks npm and
GitHub Actions dependencies weekly.

## Adding a regression test

For every bug fix, choose the lowest layer that can reproduce the failure:

1. Add a Vitest case for logic, state, and DOM contracts.
2. Add the input to the shared Markdown corpus if it is also a visible browser
   rendering contract.
3. Add a deterministic Playwright spec for focus, keyboard, geometry,
   accessibility media, or browser-specific behavior.
4. Add a package-smoke assertion only when the public tarball or exports are
   involved.

The regression should fail on the broken implementation and pass with the fix.
Keep all Markdown source assertions exact so a visual improvement cannot hide a
round-trip data change.
