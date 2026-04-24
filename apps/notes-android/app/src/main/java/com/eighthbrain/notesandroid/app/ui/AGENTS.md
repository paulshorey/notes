# `app/ui`

Compose UI for the main app plus the small overlay activities used by widget-triggered login, search, picker, and editor flows.

## Files

- `MainActivity.kt` - main activity, `NotesViewModel`, launch-intent parsing, login flow, search flow, category/tag dialogs, note list, and note editor modal.
- `WidgetOverlayActivities.kt` - `WidgetLoginActivity`, `WidgetSearchActivity`, `WidgetCategoryPickerActivity`, `WidgetTagPickerActivity`, and `WidgetNoteEditorActivity` for widget-safe input and editing flows.
- `CategoriesPopup.kt` - shared category picker/edit/delete list used by both the main app and widget overlay.
- `TagsPopup.kt` - shared tag picker/edit/delete list used by both the main app and widget overlay.

## Key concepts

- `MainActivity.kt` is intentionally large: most primary-app UI state lives in `NotesUiState` and is driven from `NotesViewModel`.
- Search is semantic, debounced, and server-backed; when the query is blank the UI falls back to notes sorted by last update.
- `LaunchRequest` normalizes both explicit widget extras and the `notes-android://search` deep link into one handling path.
- Widget delete is routed through `MainActivity.launchActionDelete` so delete and edit use the same reliable activity-start path.
- Tag editing and deletion are inline flows driven by hoisted state rather than separate screens.

## Non-obvious rules

- Keep widget-entry text or picker flows in overlay activities; do not try to add editable widget controls inside Glance.
- If you change action names or extras in `MainActivity.createLaunchIntent(...)`, update widget and overlay call sites at the same time.
- The main screen uses `snapshot.searchResults` only when there is a non-blank search query; the widget still renders from `snapshot.notes`.
- `clearWidgetExpandedStateForNote(...)` must stay aligned with widget delete behavior so stale expansion state does not remain for removed notes.

## Maintenance

Keep this file up to date after major changes in `app/src/main/java/com/eighthbrain/notesandroid/app/ui`. Edit it when screens, launch flows, shared UI components, or view-model responsibilities change.
