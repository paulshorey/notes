# `app/ui`

Compose UI for the main app plus the small overlay activities used by widget-triggered login, search, picker, and editor flows.

## Files

- `MainActivity.kt` - main activity, `NotesViewModel`, launch-intent parsing, login flow, search flow, category/tag dialogs, library/board tabs, note list, board screen, and note editor modal.
- `BoardScreen.kt` - sectioned board list grouped by workflow column; column rename trigger, note move/remove overflow menu, and `AppViewTabs` (Library | Board).
- `WorkflowStatusDialog.kt` - rename-board-column dialog (PATCH label only; matches web scope).
- `WidgetOverlayActivities.kt` - `WidgetLoginActivity`, `WidgetSearchActivity`, `WidgetCategoryPickerActivity`, `WidgetTagPickerActivity`, `WidgetDeleteNoteActivity`, and `WidgetNoteEditorActivity` for widget-safe input, confirmation, and editing flows.
- `CategoriesPopup.kt` - shared category picker/edit/delete list used by both the main app and widget overlay.
- `TagsPopup.kt` - shared tag picker/edit/delete list used by both the main app and widget overlay.

## Key concepts

- `MainActivity.kt` is intentionally large: most primary-app UI state lives in `NotesUiState` and is driven from `NotesViewModel`.
- `AppView` (`LIBRARY` | `BOARD`) is ephemeral in `NotesUiState` — not persisted. Do not reuse `WidgetMode` for this.
- Library list shows notes where `workflowStatus == null`. Board view uses `BoardScreen` with notes grouped by column. Search is global across library and board notes.
- Search is semantic, debounced, and server-backed; when the query is blank the UI falls back to notes sorted by last update.
- `LaunchRequest` normalizes both explicit widget extras and the `notes-android://search` deep link into one handling path.
- Widget delete launches `WidgetDeleteNoteActivity` (confirmation overlay), not `MainActivity`. Edit still uses `MainActivity.createLaunchIntent`. See `.cursor/skills/android-widget-actions/SKILL.md`.
- Tag editing and deletion are inline flows driven by hoisted state rather than separate screens.
- Category/tag picker counts in the main app use library notes only (`libraryNoteCountsByCategory` / `libraryNoteCountsByTag`); widget overlays still use server `noteCount` until Phase D.

## Non-obvious rules

- Keep widget-entry text or picker flows in overlay activities; do not try to add editable widget controls inside Glance.
- If you change action names or extras in `MainActivity.createLaunchIntent(...)`, update widget and overlay call sites at the same time.
- The main screen uses `snapshot.searchResults` only when there is a non-blank search query; the widget still renders from `snapshot.notes`.
- `clearWidgetExpandedStateForNote(...)` must stay aligned with widget delete behavior so stale expansion state does not remain for removed notes.
- Board note moves and remove-from-board go through `NotesRepository.setNoteWorkflowStatus()` / `noteRecordToInput()` — never partial PATCH bodies from the UI layer.
- Editor workflow controls: add to board (default column), column picker, remove from board; `timeCompleted` is read-only after sync.

## Maintenance

Keep this file up to date after major changes in `app/src/main/java/com/eighthbrain/notesandroid/app/ui`. Edit it when screens, launch flows, shared UI components, or view-model responsibilities change.
