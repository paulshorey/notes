# Notes Android

Native Android client for the Notes product. This package is not deployed to Railway. Its release step is building a canonical APK and sharing the download link in the PR.

The app always calls the deployed `notes-next` API. There is no local `server/` package here.

## Structure

- `app/` - Kotlin Android app
- `tools/` - Android/JDK/SDK helper scripts and APK build helpers

## Environment variables

| Variable | Required by | Purpose |
|----------|-------------|---------|
| `NOTES_ANDROID_API_BASE_URL` | Android APK (optional) | Override the `notes-next` URL baked into the app at build time |

The APK talks to a deployed `notes-next` over HTTPS. Which Notes database it hits is decided by the `notes-next` Railway service it calls, not by the APK itself.

### "Why does my APK still hit the dev database after I changed my shell env?"

The Android build does not read `MARKETING_DB_URL` or `JINA_API_KEY`. Those are `notes-next` server variables. Changing them in your shell and rebuilding the APK will not change anything.

To pick which `notes-next` deployment the APK calls, use the explicit build scripts:

```bash
pnpm --filter notes-android build:dist:dev   # APK calls the dev notes-next
pnpm --filter notes-android build:dist:prod  # APK calls the production notes-next
```

Known `notes-next` deployments:

- Production: `https://marketing-apps-notes-next.up.railway.app`
- Dev: `https://marketing-apps-notes-next-dev.up.railway.app`

Gradle resolves `NOTES_ANDROID_API_BASE_URL` in this order: `local.properties`, `-P` Gradle property, shell environment, script-level inline assignment. If a prior experiment left `NOTES_ANDROID_API_BASE_URL=...` in `apps/notes-android/local.properties`, it will silently override everything else. Remove the stale line. The current `local.properties` should normally only contain `sdk.dir`.

After a successful build the target URL is logged as `notes-android: API base URL = <url>` during Gradle configuration, so you can confirm what was baked into the APK before installing it.

## Local setup

```bash
pnpm run deps:install -- notes-android...
bash apps/notes-android/tools/setup-android-sdk.sh
pnpm --filter notes-android build
```

If you already have an SDK installed locally, you can set:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

If `ANDROID_HOME` points to a missing or unwritable SDK path, the build tools fall back to the repo-local SDK under `.android-sdk`.

## Relevant scripts

```bash
pnpm --filter notes-android contracts:check
pnpm --filter notes-android build:android
pnpm --filter notes-android build:dist:dev
pnpm --filter notes-android build:dist:prod
pnpm --filter notes-android build
```

- `contracts:check` validates Kotlin/API alignment with the generated Notes contract from `@lib/db-marketing`.
- `build:android` assembles the debug APK (uses whatever URL is in the environment — for iteration only, not release).
- `build:dist:dev` produces `dist/notes-android.apk` pointed at the dev `notes-next`.
- `build:dist:prod` produces `dist/notes-android.apk` pointed at the production `notes-next`.

## Release workflow

When Android changes should be shipped, build the canonical APK and share the download link in the PR:

```bash
pnpm run build:android:dist:dev    # APK pointed at the dev notes-next
pnpm run build:android:dist:prod   # APK pointed at the production notes-next
```

Both write `apps/notes-android/dist/notes-android.apk`. This package does not have a Railway deployment step.

## Home screen widget

The widget lives in `app/src/main/java/com/eighthbrain/notesandroid/app/widget/NotesHomeWidget.kt`.

It is read-only and deep-links add/search/edit flows into the main app. Widget state is local to the widget and does not modify note data.
