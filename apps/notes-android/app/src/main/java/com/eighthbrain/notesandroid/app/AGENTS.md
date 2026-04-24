# `app/src/main/java/com/eighthbrain/notesandroid/app`

Core Kotlin package for the Android client. The app is intentionally small and keeps most behavior in a few folders: `data/`, `model/`, `ui/`, `widget/`, and `work/`.

## File map

- `NotesApplication.kt` - `Application` subclass that exposes a lazy `NotesRepository` shared by activities, workers, and the widget.

## Subfolders

- `data/` - API client, JSON codec, and persistent snapshot storage.
- `model/` - domain models plus shared formatting, parsing, and sorting helpers.
- `ui/` - main Compose UI and widget-safe overlay activities.
- `widget/` - Glance home-screen widget and widget-only preference helpers.
- `work/` - WorkManager refresh scheduling.

## Non-obvious rules

- There is no DI framework; `NotesApplication.repository` is the single app-wide entry point.
- `AppSnapshot` is the durable state model, but widget-only UI state such as expanded rows and selected widget tag lives in Glance preferences, not in `SessionStore`.
- Keep shared domain logic out of `ui/` when it is needed by widget or repository code; prefer `model/`.

## Maintenance

Keep this file up to date after major changes in `app/src/main/java/com/eighthbrain/notesandroid/app`. Edit it when package boundaries, app wiring, or folder responsibilities change.
