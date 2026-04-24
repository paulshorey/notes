---
name: android-development
description: Development guide for `apps/notes-android`. Use when editing Android/Kotlin code, running builds, or troubleshooting. Covers both cloud and local workflows. Only use when working on Android code.
---

## Relationship to other skills

- **android-build**: Use that skill (not this one) when you need to produce a distributable APK in a cloud workspace.
- **Root AGENTS.md**: Working-directory and monorepo conventions are defined there; this skill does not repeat them.

## Cloud agents

### First-time setup

```bash
pnpm run cloud:install
```

### Repair / refresh SDK

```bash
bash apps/notes-android/tools/setup-android-sdk.sh
```

### Build

Prefer the `android-build` skill for producing the APK artifact. For a full build including the Node server:

```bash
pnpm --filter notes-android build
```

## Local agents

### Prerequisites

See `apps/notes-android/README.md` for local macOS setup (`ANDROID_HOME`, `local.properties`).

### Validating code changes

After editing Kotlin code, type-check without a full APK assembly:

```bash
bash apps/notes-android/gradlew --no-daemon -p apps/notes-android :app:compileDebugKotlin
```

### Building and installing (optional)

```bash
pnpm --filter notes-android build:android
adb install -r apps/notes-android/app/build/outputs/apk/debug/app-debug.apk
```

If `adb` is unavailable: `brew install android-platform-tools`

## Node companion server

The app has an Express API server under `server/`. Run it locally:

```bash
pnpm --filter notes-android dev
```

## Debugging

Stop Gradle daemons and clean rebuild:

```bash
bash apps/notes-android/gradlew --stop
rm -rf "${GRADLE_USER_HOME:-$HOME/.gradle}/caches" apps/notes-android/.gradle apps/notes-android/app/build
pnpm --filter notes-android build:android
```
