# `app/src/main`

Main Android app payload: manifest, Kotlin source, and packaged resources.

## Folder map

- `AndroidManifest.xml` - declares the application class, main activity, widget overlay activities, and widget receiver.
- `java/com/eighthbrain/notesandroid/app/` - Kotlin app code. See the nearer `AGENTS.md` files under `data`, `model`, `ui`, `widget`, and `work`.
- `res/` - packaged resources used by the app and widget. See `res/AGENTS.md`.

## Architecture

- `NotesApplication` exposes a lazy `NotesRepository` used by activities, workers, and the widget.
- `SessionStore` persists the canonical `AppSnapshot`; the widget reads that snapshot and layers widget-only Glance preferences on top.
- The main app UI lives in `ui/MainActivity.kt`; widget-safe overlays such as login, search, category, tag, and note-editor flows live in `ui/WidgetOverlayActivities.kt`.
- The widget implementation lives in `widget/NotesHomeWidget.kt` and is intentionally read-only.

## Non-obvious rules

- Widget actions that need text input or picker-style UI must launch overlay activities instead of trying to edit inside Glance.
- `notes-android://search` is a real deep link handled by `MainActivity`.
- `AndroidManifest.xml` marks the overlay activities as dialog-themed, `noHistory`, and excluded from recents; keep that behavior if they stay widget-only helpers.

## Maintenance

Keep this file up to date after major changes in `app/src/main`. Edit it when app entrypoints, deep links, source layout, or resource layout change.
