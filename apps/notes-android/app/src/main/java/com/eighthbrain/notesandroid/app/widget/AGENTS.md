# `widget`

Glance home-screen widget implementation for Notes. This folder owns widget rendering, widget-only preference state, and widget callbacks.

## Files

- `NotesHomeWidget.kt` - `GlanceAppWidget`, receiver, toolbar, note rows, widget callbacks, and helper functions for widget-local state.

## Core concepts

- The widget renders from `AppSnapshot` via `repository.snapshots.collectAsState` inside `provideContent` (not a one-shot read in `provideGlance`).
- `widgetSnapshotRevisionKey` is bumped on every `NotesRepository.persist()` so active Glance sessions recompose after overlay/API writes.
- Widget-only UI state is stored in Glance preferences, not in `SessionStore`.
- `widgetCategoryFilterKey` and `widgetTagFilterKey` store the widget's category and tag filters.
- `expanded_<noteId>` preference keys store per-note expand/collapse state.
- **Library only:** the note list filters to `workflowStatus == null` (off-board notes). Board tasks are managed in `MainActivity`; widget capture stays library-first.

## Non-obvious behavior

- The widget is intentionally read-only for text input; add/search/edit flows route into `MainActivity` or small overlay activities.
- `RefreshNotesAction` re-syncs through `repository.restoreSession(...)`; the widget never talks to the API directly.
- Delete launches `WidgetDeleteNoteActivity` (dialog overlay). Do not use `actionRunCallback` for API delete inside `LazyColumn` rows — it silently fails on many launchers. See `.cursor/skills/android-widget-actions/SKILL.md`.
- `clearWidgetExpandedStateForNote(...)` must be kept in sync with delete flows so removed notes do not leave stale expanded state behind.
- `SignInOnly` and `LogoutAction` are currently unused; confirm they are truly dead before removing them.
- Widget icons must stay as Android drawable resources; do not replace them with Compose-only vectors.
- Widget category/tag picker overlays use library-only note counts (`libraryPickerCounts` in `Models.kt`), cross-filtered by the other active widget filter.

## Maintenance

Keep this file up to date after major changes in `app/src/main/java/com/eighthbrain/notesandroid/app/widget`. Edit it when widget actions, Glance state keys, launch routing, or row behavior changes.
