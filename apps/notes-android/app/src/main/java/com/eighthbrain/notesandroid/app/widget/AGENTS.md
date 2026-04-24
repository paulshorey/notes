# `widget`

Glance home-screen widget implementation for Notes. This folder owns widget rendering, widget-only preference state, and widget callbacks.

## Files

- `NotesHomeWidget.kt` - `GlanceAppWidget`, receiver, toolbar, note rows, widget callbacks, and helper functions for widget-local state.

## Core concepts

- The widget renders from the persisted `AppSnapshot` loaded by `NotesRepository.readSnapshot()`.
- Widget-only UI state is stored in Glance preferences, not in `SessionStore`.
- `widgetCategoryFilterKey` and `widgetTagFilterKey` store the widget's category and tag filters.
- `expanded_<noteId>` preference keys store per-note expand/collapse state.

## Non-obvious behavior

- The widget is intentionally read-only for text input; add/search/edit flows route into `MainActivity` or small overlay activities.
- `RefreshNotesAction` re-syncs through `repository.restoreSession(...)`; the widget never talks to the API directly.
- Delete is routed through `MainActivity.launchActionDelete` because nested `actionRunCallback` inside `LazyColumn` is less reliable across launchers.
- `clearWidgetExpandedStateForNote(...)` must be kept in sync with delete flows so removed notes do not leave stale expanded state behind.
- `SignInOnly` and `LogoutAction` are currently unused; confirm they are truly dead before removing them.
- Widget icons must stay as Android drawable resources; do not replace them with Compose-only vectors.

## Maintenance

Keep this file up to date after major changes in `app/src/main/java/com/eighthbrain/notesandroid/app/widget`. Edit it when widget actions, Glance state keys, launch routing, or row behavior changes.
