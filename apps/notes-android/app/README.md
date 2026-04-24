# `app`

Android application module for `notes-android`.

## What lives here

- `build.gradle.kts` - Android module build config, dependencies, signing, and API base URL wiring.
- `src/main/` - manifest, Kotlin source, and packaged resources.
- `debug.keystore` - shared debug signing key for local and CI debug APKs.

## Notes for developers

- The app uses Jetpack Compose for the main UI and Glance for the home-screen widget.
- `BuildConfig.DEFAULT_API_BASE_URL` is generated from `NOTES_ANDROID_API_BASE_URL` when provided, otherwise it uses the package default.
- If you change SDK versions in `build.gradle.kts`, also update the Android SDK install script under `../tools/`.
