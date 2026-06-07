---
name: android-widget-actions
description: Glance AppWidget user interaction guide for notes-android — actionStartActivity, actionRunCallback, LazyColumn click limits, dialog overlay activities, MainActivity launch intents, network/API deletes, text input, pickers, confirmation popups, widget refresh via NotesRepository.persist. Read before adding widget buttons or flows that may be impossible inside Glance.
---

## When to read this

Read this skill **before** adding or changing any Glance widget button, tap target, or user flow in `apps/notes-android`.

Use it when the requested behavior involves any of:

- Text input, forms, or pickers
- Network/API calls (create, update, delete, search)
- Confirmation dialogs or destructive actions
- Navigation to full app screens
- Click handlers inside `LazyColumn` list rows

If you are unsure whether something can run inside the widget, assume **no** until you verify against the tables below.

## Relationship to other docs

- **`android-development`**: build commands and general Android workflow.
- **`apps/notes-android/AGENTS.md`**: package overview; points here for widget actions.
- **`app/.../widget/AGENTS.md`**: widget-specific state keys and file map.
- **`app/.../ui/AGENTS.md`**: overlay activities and `MainActivity` launch routing.
- **`app/.../data/AGENTS.md`**: `NotesRepository.persist()` refreshes widgets after writes.

Official Glance reference: [Handle user interaction](https://developer.android.com/develop/ui/compose/glance/user-interaction)

## Core constraint

Glance widgets render as **remote views** in the launcher process. User taps become `PendingIntent`s or `BroadcastReceiver` callbacks with strict background limits. The widget cannot host:

- Editable text fields
- Dropdowns with real input
- Modal dialogs
- Direct reliable network work from nested list-item callbacks

Design widget UX as **read-only surface + launch targets**.

## What works vs what does not

| Need | Works in Glance? | Use instead |
|------|------------------|-------------|
| Toggle local widget UI state (expand row, filter chip) | **Sometimes** — `actionRunCallback` on toolbar or simple rows | `ActionCallback` + `updateAppWidgetState` + `NotesHomeWidget().update()` |
| `actionRunCallback` inside nested `LazyColumn` row for API delete/save | **No** — often silent no-op across launchers | Dialog overlay activity |
| `actionRunCallback` with network/API call | **Unreliable** — background receiver limits | Overlay activity or `WorkManager` + widget `update()` |
| Text entry (login, search query, note body) | **No** | `Widget*Activity` overlay in `WidgetOverlayActivities.kt` |
| Picker UI (category, tag lists with edit/delete) | **No** | Overlay activity |
| Confirmation before destructive action | **No** | `WidgetDeleteNoteActivity`-style overlay |
| Open full note editor | **Yes** | `actionStartActivity(MainActivity.createLaunchIntent(...))` |
| Open small helper UI | **Yes** | `actionStartActivity(Intent(context, WidgetFooActivity::class.java))` |
| Refresh widget after data change | **Yes** (indirect) | `NotesRepository` method → `persist()` → `NotesHomeWidget().updateAll()` |
| Show error toast in widget | **No** | Persist `lastError` in snapshot or show in overlay |

### Click targeting inside lists

Nested clickables in Glance lists are fragile: child `Text`/`Image` nodes may steal taps from a parent `.clickable()` row ([known Glance issue](https://stackoverflow.com/questions/73770486/glanceappwidget-with-clickable-row-inner-elements-steal-focus-and-clicks)). Prefer:

- One clickable per leaf control (icon button, row header)
- `actionStartActivity` for row actions that must work on all launchers
- `actionRunCallback` only for **local preference toggles** you have tested on a real device

## Three action patterns in this app

### 1. `actionRunCallback` — local widget state only

**Good for:** expand/collapse, toggling Glance preferences, toolbar refresh that delegates to repository from a **non-nested** control.

**Examples in `NotesHomeWidget.kt`:**

- `ToggleExpandedAction` — flips `expanded_<noteId>` preference
- `RefreshNotesAction` — calls `repository.restoreSession(...)`

```kotlin
.clickable(
    actionRunCallback<ToggleExpandedAction>(
        actionParametersOf(NoteActionKeys.noteId to note.id.toString()),
    ),
)
```

After local state changes:

```kotlin
updateAppWidgetState(context, glanceId) { prefs -> /* ... */ }
NotesHomeWidget().update(context, glanceId)
```

**Do not use for:** API delete, save note, login, or other network work from inside `LazyColumn` items. We tried `DeleteNoteAction` this way; the button did nothing.

### 2. `actionStartActivity` → dialog overlay — short widget helper flows

**Good for:** text input, pickers, confirmations, any API work that should not open the full app.

**Pattern:**

1. Widget button uses `actionStartActivity(Intent(context, WidgetFooActivity::class.java).apply { putExtra(...) })`
2. Add activity to `AndroidManifest.xml` with:
   - `android:theme="@style/Theme.NotesAndroid.Dialog"`
   - `android:noHistory="true"`
   - `android:excludeFromRecents="true"`
   - `android:exported="false"`
   - `android:taskAffinity=""`
3. Implement screen in `WidgetOverlayActivities.kt` using `OverlayCard` / `OverlayTheme`
4. Call `NotesRepository` methods from the overlay; `finish()` when done

**Existing overlays:**

| Activity | Purpose |
|----------|---------|
| `WidgetLoginActivity` | Username sign-in |
| `WidgetSearchActivity` | Semantic search query |
| `WidgetCategoryPickerActivity` | Category filter + CRUD |
| `WidgetTagPickerActivity` | Tag filter + CRUD |
| `WidgetDeleteNoteActivity` | Delete confirmation + API delete |
| `WidgetNoteEditorActivity` | Full note form in overlay (legacy/alternate) |

**Delete flow (canonical example):**

```kotlin
actionStartActivity(
    intent = Intent(context, WidgetDeleteNoteActivity::class.java).apply {
        putExtra(WidgetDeleteNoteActivity.extraNoteId, note.id)
    },
)
```

Overlay confirms, calls `repository.deleteNote(noteId)`, `clearWidgetExpandedStateForNote(...)`, then `finish()`. Widget refreshes automatically.

### 3. `actionStartActivity` → `MainActivity` — full app experiences

**Good for:** add note, edit note, focus search in main app.

Use `MainActivity.createLaunchIntent(...)` with extras:

- `launchActionAdd`, `launchActionEdit`, `launchActionSearch`
- `extraLaunchNoteId`, `extraLaunchCategoryId`, `extraLaunchFocusSearch`

Handled by `LaunchRequest.fromIntent` in `MainActivity.kt`.

**Prefer overlay over MainActivity when:** the user should stay on the home screen and only needs a brief interaction (delete confirm, picker, login).

## Widget refresh after data changes

Never call the API directly from Glance composables. Always go through `NotesRepository`.

```text
Overlay / MainActivity / ActionCallback
        ↓
NotesRepository.deleteNote / saveNote / login / ...
        ↓
persist(snapshot)
        ↓
NotesHomeWidget().updateAll(appContext)
```

Widget reads data from `repository.readSnapshot()` inside `provideGlance`.

For widget-only UI state (expanded rows, category/tag filters), use Glance preferences (`PreferencesGlanceStateDefinition`), not `SessionStore`.

## Checklist: adding a new widget action

1. **Classify the work** using the table above.
2. If it touches the network, needs input, or needs confirmation → **overlay activity** (or MainActivity for full flows).
3. Add manifest entry for new overlay activities (copy an existing widget activity block).
4. Wire widget button with `actionStartActivity`, passing intent extras.
5. Implement overlay screen in `WidgetOverlayActivities.kt`; reuse `OverlayCard`.
6. Use `NotesRepository` for mutations; do not duplicate API client calls in the widget package.
7. If deleting a note, call `clearWidgetExpandedStateForNote(context, noteId)`.
8. Compile: `bash apps/notes-android/gradlew --no-daemon -p apps/notes-android :app:compileDebugKotlin`
9. Test on a real device/emulator — Glance click behavior varies by launcher.

## Anti-patterns (learned from this repo)

| Attempt | Result |
|---------|--------|
| `actionRunCallback` + `repository.deleteNote` inside `LazyColumn` delete icon | Button does nothing |
| `MainActivity.launchActionDelete` from widget | Works but opens full app; widget stayed stale until manual refresh |
| Inline Glance text field for search/login | Not supported — use overlay |
| Calling API from `provideGlance` | Wrong layer — widget only reads snapshot |

## Key files

| File | Role |
|------|------|
| `app/.../widget/NotesHomeWidget.kt` | Glance UI, toolbar/row actions, local callbacks |
| `app/.../ui/WidgetOverlayActivities.kt` | Dialog-themed widget helper activities |
| `app/.../ui/MainActivity.kt` | Full app + `createLaunchIntent` / `LaunchRequest` |
| `app/.../data/NotesRepository.kt` | API + `persist()` + widget `updateAll` |
| `app/src/main/AndroidManifest.xml` | Overlay activity registration |

## Decision flow

```text
New widget tap target
├─ Only toggles Glance preference / local expand?
│  └─ actionRunCallback (test on device; avoid deep LazyColumn nesting)
├─ Needs text, picker, confirm, or API call?
│  ├─ Brief helper UI → Widget*Activity overlay
│  └─ Full app experience → MainActivity.createLaunchIntent
└─ After any repository write → persist() already refreshes widget
```
