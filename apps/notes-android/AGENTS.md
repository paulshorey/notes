# `notes-android`

Native Android Notes client built with Kotlin, Jetpack Compose, WorkManager, and Glance. It talks to the deployed `notes-next` REST API only; this package does not currently contain a local `server/` folder and does not access Postgres directly.

## Folder map

- `app/` - Android application module; manifest, Kotlin source, resources, signing, and module build config. See `app/AGENTS.md`.
- `tools/` - Android/JDK/SDK bootstrap and build scripts. See `tools/AGENTS.md`.
- `test/` - TypeScript adapter test entrypoint. See `test/AGENTS.md`.

## Root file map

- `package.json` - pnpm/Turbo package metadata; `build` runs contract validation then Android debug assembly; `build:dist:dev` and `build:dist:prod` produce the canonical APK pointed at the respective `notes-next` deployment.
- `build.gradle.kts` - root plugin version declarations for AGP and Kotlin Compose.
- `settings.gradle.kts` - Gradle repositories and the single included `:app` module.
- `gradle.properties` - Gradle defaults such as configuration cache, parallelism, AndroidX, and non-transitive R classes.
- `gradlew` / `gradlew.bat` - Gradle wrapper entrypoints.
- `README.md` - human setup instructions for building the Android app.
- `.gitignore` - ignores local Android/Gradle outputs plus `local.properties`.

## Non-obvious rules

- Widget text-entry flows must use overlay activities because home-screen widgets cannot host editable text fields.
- `local.properties` is machine-local and intentionally ignored; it can carry `sdk.dir` and `NOTES_ANDROID_API_BASE_URL`.
- `app/build.gradle.kts` injects `BuildConfig.DEFAULT_API_BASE_URL` from `local.properties`, a Gradle property, or `NOTES_ANDROID_API_BASE_URL`.
- The committed debug keystore is intentional so locally built and CI-built debug APKs share a certificate and can upgrade each other.
- `package.json` includes `@gravity-ui/*` packages even though the shipped app is Kotlin-only; do not assume web UI code lives here.

## Commands

- Prefer repo-root commands: `pnpm --filter notes-android ...`, `bash apps/notes-android/tools/...`, or `bash apps/notes-android/gradlew --no-daemon -p apps/notes-android ...`.
- `pnpm --filter notes-android contracts:check` validates Kotlin/API alignment with `@lib/db-marketing`.
- `pnpm --filter notes-android build:contracts` remains as an alias for the contract check.
- `pnpm --filter notes-android build:android` assembles the debug APK.
- `pnpm --filter notes-android build:dist:dev` produces `dist/notes-android.apk` pointed at the dev `notes-next`.
- `pnpm --filter notes-android build:dist:prod` produces `dist/notes-android.apk` pointed at the production `notes-next`.
- `pnpm --filter notes-android build` runs contract validation plus Android assembly.

## Release rules

- Android release means generating the APK artifact and sharing the PR download link.
- This package does not have a Railway service and should never be documented as one.
- Notes DB migrations belong in `lib/db-marketing`, not here.
- The APK does not read `MARKETING_DB_URL` or `JINA_API_KEY`. Those are server-side variables on the `notes-next` Railway service. To switch the APK between environments, use `build:dist:dev` or `build:dist:prod`.
- `local.properties` takes precedence over the shell environment for `NOTES_ANDROID_API_BASE_URL`. If a rebuild does not change which backend the APK hits, check for a stale `NOTES_ANDROID_API_BASE_URL=` line in `apps/notes-android/local.properties` and remove it.

## Maintenance

Keep this file up to date after major changes in `apps/notes-android`. Edit it when package structure, build flow, API integration, or key folders change.
