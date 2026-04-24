# Eighth Brain

`apps/eighthbrain-next` is the Eighth Brain marketing site. It is deployed to Railway and does not participate in the Notes database migration flow.

## Local workflow

```bash
pnpm run deps:install -- eighthbrain-next...
pnpm --filter eighthbrain-next dev
```

The local dev server runs on `http://localhost:3340`.

## Relevant scripts

```bash
pnpm run verify:eighthbrain
pnpm --filter eighthbrain-next build
pnpm --filter eighthbrain-next lint
pnpm --filter eighthbrain-next typecheck
pnpm --filter eighthbrain-next verify
```

`pnpm run verify:eighthbrain` (root alias) and `pnpm --filter eighthbrain-next verify` (package-scoped) are equivalent. Run either before deploying to Railway.

## Deployment

Deploy `apps/eighthbrain-next` on Railway. Railway build/start behavior is defined in `apps/eighthbrain-next/railway.json`.

This app should stay independent from `lib/db-marketing` and should not require `MARKETING_DB_URL` for its health check or normal deployment.

## Live site

[eighthbrain.ai](https://eighthbrain.ai)
