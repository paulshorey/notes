# `app`

Android application module for `notes-android`.

## Files in this folder

- `build.gradle.kts` - module build config; sets SDK levels, Compose, Java 17, signing, dependencies, and `BuildConfig.DEFAULT_API_BASE_URL`.
- `proguard-rules.pro` - placeholder for release shrinker rules; release minification is currently off.
- `debug.keystore` - committed debug signing key so local and CI debug APKs can upgrade each other.
- `src/main/` - manifest, Kotlin source, and Android resources. See `src/main/AGENTS.md`.

## Non-obvious rules

- `NOTES_ANDROID_API_BASE_URL` can come from `local.properties`, a Gradle property, or the environment (in that resolution order); `build.gradle.kts` bakes the resolved value into `BuildConfig.DEFAULT_API_BASE_URL` and logs it during configuration.
- The APK never reads `MARKETING_DB_URL`, `JINA_API_KEY`, or any other server-side env; those only live on the `notes-next` Railway service that the APK calls.
- `compileSdk` / `targetSdk` currently track API 36; if you bump them, also update `tools/install-android-sdk.sh`.
- The committed debug keystore is intentional; do not rotate or remove it casually because sideloaded debug upgrades depend on a stable certificate.

## Maintenance

Keep this file up to date after major changes in `apps/notes-android/app`. Edit it when module build settings, signing behavior, or top-level module files change.
