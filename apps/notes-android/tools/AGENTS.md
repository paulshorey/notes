# `tools`

Shell scripts for provisioning the Android toolchain and producing debug/distribution APKs in local and cloud environments.

## File map

- `check-prereqs.sh` - fails early when required host commands such as `java`, `python3`, `curl`, `unzip`, or `yes` are missing.
- `install-jdk.sh` - installs a repo-local JDK into `.jdk/current`; honors `REPO_JAVA_HOME` and `JDK_DOWNLOAD_URL`.
- `install-android-sdk.sh` - installs Android command-line tools plus `platform-tools`, `platforms;android-36`, and `build-tools;36.0.0`.
- `setup-android-sdk.sh` - chooses `ANDROID_HOME`, wires `ANDROID_USER_HOME` and `GRADLE_USER_HOME`, sets `JAVA_HOME` when possible, installs the SDK if needed, and writes `sdk.dir` to `local.properties`.
- `build-android.sh` - sources setup and runs `:app:assembleDebug`.
- `build-dist-apk.sh` - builds the debug APK, expects exactly one `*-debug.apk`, then copies it to `dist/notes-android.apk`.
- `cloud-provision.sh` - one-shot cloud bootstrap for repo-local JDK, SDK, and Gradle warmup.
- `validate-marketing-contract.mjs` - strict contract checker for `Models.kt`, `JsonCodec.kt`, and `NotesApiClient.kt` against generated `@lib/db-marketing` contract JSON.

## Non-obvious rules

- Keep `install-android-sdk.sh` aligned with `compileSdk` and `targetSdk` in `app/build.gradle.kts`; the current scripts assume API 36 and build-tools 36.0.0.
- `setup-android-sdk.sh` defaults caches to repo-local `.android-user-home` and `.gradle`, not the user home directory.
- If `ANDROID_HOME` points to a missing and unwritable location, `setup-android-sdk.sh` falls back to the repo-local SDK path instead of failing early.
- `build-dist-apk.sh` is intentionally strict and fails if flavors or output layout changes produce zero or multiple debug APKs.
- `validate-marketing-contract.mjs` checks field order and even some string snippets, so cosmetic Kotlin refactors can break it.

## Maintenance

Keep this file up to date after major changes in `apps/notes-android/tools`. Edit it when scripts, environment variables, SDK/JDK assumptions, or APK output flow change.
