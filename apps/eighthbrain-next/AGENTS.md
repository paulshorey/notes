# `eighthbrain-next`

Marketing site for Eighth Brain.

**Live:** [eighthbrain.ai](https://eighthbrain.ai)

## Deployment model

- This package is deployed to Railway.
- It does not participate in the Notes database migration flow.
- It should not depend on `@lib/db-marketing`, `MARKETING_DB_URL`, or other Notes-only runtime concerns.

## Overview

- 3D force-directed knowledge graph visualization
- Newsletter or waitlist modal flow
- Responsive marketing layout

## Tech stack

- Next.js 14
- Tailwind CSS
- TypeScript

## Commands

```bash
pnpm --filter eighthbrain-next dev
pnpm --filter eighthbrain-next build
pnpm --filter eighthbrain-next verify
```

## Conventions

- Import shared Tailwind CSS from `@lib/config/tailwind`, not deep paths like `@lib/config/tailwind/shared-styles.css`, because Next/PostCSS resolves package CSS through the package `exports` map.
- Keep `app/api/health/route.ts` as a simple app liveness check, not a Notes DB connectivity check.
