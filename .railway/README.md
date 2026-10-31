# Notes Railway Infrastructure as Code

`.railway/railway.ts` exports the `notes` partial in Railway project **Notes**
(`7c451bd1-350a-4fb3-a08f-5295863269ce`). The partial owns the web service and the
`media` storage bucket. Postgres, its volume, and the `Postgres-PITR` backup bucket
in the same project stay under dashboard ownership; the partial never edits them.

| Environment      | Service         | Source branch      | Environment ID                       | Domain      |
| ---------------- | --------------- | ------------------ | ------------------------------------ | ----------- |
| dev              | apps/notes-next | main               | 8cbb1415-ac2b-46c3-ae8c-144265017189 | dev.jot.new |
| production       | apps/notes-next | prod               | f65d1bcb-a786-4678-a431-e9f6c3ff154f | jot.new     |
| Notes PR preview | apps/notes-next | existing PR branch | dynamic                              | dynamic     |

Notes previously lived in the multi-repository WebArts project
(`c6260c51-8b01-4934-8ccb-9cf32456744c`, since renamed **Experimental**). That project
no longer serves Notes deployments; do not plan this file against it.

## Applied configuration

Railway evaluates IaC through `railway config plan/apply`, **not during a GitHub
source deployment**. The Settings page displays the live applied commands. Keep the
legacy **Railway Config File** field empty; it must not point to `railway.ts`.

Use Node 24, pnpm 10.28.1, pinned Railway CLI 5.62.1, and SDK 3.11.0. Run secret-bearing
commands under `bash`; zsh prints an existing variable's value when `local`/`typeset`
re-declares it inside a loop.

```bash
pnpm install --frozen-lockfile
pnpm railway:config:check
bash --noprofile --norc -c '
  source "$HOME/.secrets.sh" >/dev/null 2>&1
  unset RAILWAY_TOKEN
  export RAILWAY_PROJECT_ID=7c451bd1-350a-4fb3-a08f-5295863269ce
  export RAILWAY_ENVIRONMENT_ID=8cbb1415-ac2b-46c3-ae8c-144265017189
  pnpm railway:config:plan
'
```

The workspace API token in `~/.secrets.sh` uses the standard `RAILWAY_API_TOKEN`
name. Never print or commit token values. A `RAILWAY_TOKEN` takes precedence over
the API token, so unset it when deliberately using the workspace profile.

Review every plan. An ordinary settings change should touch only the declared
service and bucket. Stop on variable deletion, service replacement, source
disconnection, or unexpected database/domain changes. Do not use
`--confirm-destructive` to bypass an incomplete import. After an apply, require
`railway config plan --detailed-exit-code` to report no changes.

## Variables

Provider secrets are set in Railway and declared with `preserve()`, so source never
contains their values. The `media` bucket's S3 credentials are Railway references
(`MEDIA_BUCKET_NAME`, `_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`);
buckets are private and use virtual-hosted-style URLs.

| Variables                                                                           | Source                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `AUTH_SECRET`, `AUTH_TRUST_HOST`, `DB_NOTES_URL`, `JINA_API_KEY`, `OPENAI_API_KEY`  | Existing Notes values                                                          |
| `RESEND_EMAIL_API_KEY`, `RESEND_FROM_ADDRESS`                                       | Temporarily copied from Livx `apps/backend`; replace with a Notes sender later |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_TO_NUMBER` | Personal developer account copied from Paul; not registered for public SMS     |

Adding a secret means setting it in each environment first
(`railway variable set KEY --stdin --skip-deploys`), then adding `preserve()` here.
A `preserve()` entry for a variable that does not exist does not create it.

## GitHub Actions

`.github/workflows/railway-iac.yml` plans same-repository PRs targeting `main`
or `prod`. A push to either branch applies a fresh pinned plan to dev or production,
respectively. It also supports manual dispatch on those branches. Fork PRs get no token.
The workflow checks IaC types, rejects an outdated branch commit, applies against the
planned environment etag and `.railway` tree, and requires a clean plan afterward.
Destructive applies are disabled. Resource or variable removals require a
separately reviewed operational change. Rerun a job if a concurrent apply makes its
saved plan stale.

Secrets are environment-scoped project tokens for the Notes project:

- `NOTES_RAILWAY_TOKEN_DEV` — dev only;
- `NOTES_RAILWAY_TOKEN_PRODUCTION` — production only.

The workflow must exist on each deployment branch. A PR plan does not change live
configuration; merge is what enables the push apply. Application source deployment
continues through Railway's existing GitHub integration.

## Existing and future previews

New PR environments inherit the applied dev configuration. Existing previews retain
their cloned settings and must be explicitly synced or applied after base changes.
IaC changes in a PR do not automatically apply themselves to that PR's preview.
For an intentional preview update, use the exact environment ID and its current branch:

```bash
export RAILWAY_ENVIRONMENT_ID=<preview environment id>
export RAILWAY_IAC_BRANCH=<preview branch>
pnpm railway:config:plan
pnpm railway:config:apply
```

CLI 5.62.1 can omit the environment name in authoring context; the definition selects
persistent environments by ID. Omitting `source.branch` can clear the selected branch,
so preview evaluation fails until `RAILWAY_IAC_BRANCH` is provided. Preserve the current
branch; never silently replace a preview with `main`.

The desired pre-deploy command is `pnpm --filter @lib/db-items db:migrate`.
The deprecated `@lib/db-notes` package forwards migration commands while older
applied settings still reference it. Both package paths remain in build watches.
`DB_NOTES_URL` stays preserved in Railway; the item service accepts it as a fallback.
See [the item-core rollout](../docs/db/item-core.md).

The backend migrations are a pre-deploy step and the `/api/health` readiness endpoint
must return 200. Watch paths include the app, shared libraries, lockfile, and workspace
build configuration. Sealed variables are not cloned into previews; provision any
required sealed values separately. Existing DB connection references remain in Railway.

Sources: [Railway IaC](https://docs.railway.com/infrastructure-as-code),
[DSL reference](https://docs.railway.com/infrastructure-as-code/reference),
[CLI config](https://docs.railway.com/cli/config),
[Storage Buckets](https://docs.railway.com/storage-buckets).
