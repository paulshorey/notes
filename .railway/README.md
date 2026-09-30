# WebArts Railway Infrastructure as Code

`.railway/railway.ts` exports the `notes` partial in Railway project **WebArts**
(`c6260c51-8b01-4934-8ccb-9cf32456744c`). WebArts contains multiple repositories,
so a whole-project definition containing only Notes would delete unrelated resources.
The partial owns only the existing Notes app, preserves its five Railway variables,
and leaves databases, volumes, domains, and other repositories under their existing ownership.

| Environment | Service | Source branch | Environment ID |
| --- | --- | --- | --- |
| dev | apps/notes-next | main | 4e7d33aa-1de0-441f-a105-352bbe3b6697 |
| production | notes | prod | 46907359-520d-41a3-adf3-6ed23379b418 |
| Notes PR preview | apps/notes-next | existing PR branch | dynamic |

## Applied configuration

Railway evaluates IaC through `railway config plan/apply`, **not during a GitHub
source deployment**. The Settings page displays the live applied commands. Keep the
legacy **Railway Config File** field empty; it must not point to `railway.ts`.
The obsolete `/apps/notes-next/railway.json` reference was removed from dev and all
four existing previews on 2026-09-30. Production already had no legacy reference.

Use Node 24, pnpm 10.28.1, pinned Railway CLI 5.62.1, and SDK 3.11.0:

```bash
pnpm install --frozen-lockfile
pnpm railway:config:check
source ~/.config/railway/webarts.env
export RAILWAY_PROJECT_ID=c6260c51-8b01-4934-8ccb-9cf32456744c
export RAILWAY_ENVIRONMENT_ID=4e7d33aa-1de0-441f-a105-352bbe3b6697
pnpm railway:config:plan
pnpm railway:config:apply
pnpm exec railway config plan --detailed-exit-code
```

The separate local credentials profile uses the standard `RAILWAY_API_TOKEN` name.
Source it only for WebArts work; the global profile belongs to another workspace.
Never print or commit token values. A `RAILWAY_TOKEN` takes precedence over the API
token, so unset it when deliberately using the workspace profile.

Review every plan. An ordinary settings migration should change only the declared
service's build/deploy settings. Stop on variable deletion, service replacement,
source disconnection, or unexpected database/domain changes. Do not use
`--confirm-destructive` to bypass an incomplete import.

## GitHub Actions

`.github/workflows/railway-webarts.yml` plans same-repository PRs targeting `main`
or `prod`. A push to either branch applies a fresh pinned plan to dev or production,
respectively. It also supports manual dispatch on those branches. Fork PRs get no token.
The workflow checks IaC types, rejects an outdated branch commit, applies against the
planned environment etag and `.railway` tree, and requires a clean plan afterward.
Destructive applies are disabled. Resource or variable removals require a
separately reviewed operational change. Rerun a job if a concurrent repository apply
makes its saved plan stale.

Secrets are environment-scoped project tokens:

- `WEBARTS_RAILWAY_TOKEN_DEV` — dev only;
- `WEBARTS_RAILWAY_TOKEN_PRODUCTION` — production only.

The workflow must exist on each deployment branch. A PR plan does not change live
configuration; merge is what enables the push apply. Application source deployment
continues through Railway's existing GitHub integration.

## Existing and future previews

New PR environments inherit the applied dev configuration. Existing previews retain
their cloned settings and must be explicitly synced or applied after base changes.
IaC changes in a PR do not automatically apply themselves to that PR's preview.
For an intentional preview update, use the exact environment ID and its current branch:

```bash
export RAILWAY_ENVIRONMENT_ID=bd22f1e0-e185-4cc3-b3cc-104fd724ee68
export RAILWAY_IAC_BRANCH=redesign
pnpm railway:config:plan
pnpm railway:config:apply
```

CLI 5.62.1 can omit the environment name in authoring context; the definition selects
persistent environments by ID. Omitting `source.branch` can clear the selected branch,
so preview evaluation fails until `RAILWAY_IAC_BRANCH` is provided. Preserve the current
branch; never silently replace a preview with `main`.

The backend migrations are a pre-deploy step and the `/api/health` readiness endpoint
must return 200. Watch paths include the app, shared libraries, lockfile, and workspace
build configuration. Sealed variables are not cloned into previews; provision any
required sealed values separately. Existing DB connection references remain in Railway.

## Migration audit

WebArts' four former Config as Code app services are now represented by named partials:

| Repository | Partial | Service names | Authoring file |
| --- | --- | --- | --- |
| paulshorey/notes | notes | apps/notes-next (dev/previews), notes (production) | .railway/railway.ts |
| paulshorey/nlp | nlp | apps/be, apps/fe | .railway/railway.ts |
| paulshorey/map | map | apps/map | .railway/webarts.ts |

Map's default `.railway/railway.ts` targets the separate **World** project. Use its
explicit `webarts.ts` file for WebArts. Every file targeting WebArts exports a partial;
never apply a whole-project file alongside them. Inspect ownership with
`pnpm exec railway config partials list`.

Sources: [Railway IaC](https://docs.railway.com/infrastructure-as-code),
[DSL reference](https://docs.railway.com/infrastructure-as-code/reference),
[CLI config](https://docs.railway.com/cli/config).
