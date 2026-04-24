# `app/src/main/java/com/eighthbrain/notesandroid/app/model`

Shared domain types and formatting helpers used by the main app, overlay activities, repository, and widget.

## File map

- `Models.kt` - core data classes (`UserSummary`, `TagRecord`, `NoteRecord`, `SemanticSearchResult`, `AppSnapshot`, `NoteDraft`) plus date parsing, headline/body extraction, sort helpers, and similarity formatting.

## Non-obvious rules

- `AppSnapshot` is the durable app-state shape saved by `SessionStore`; treat it as the canonical snapshot for persisted data.
- The field order and types of the contract-backed data classes matter because `tools/validate-marketing-contract.mjs` checks them against `@lib/db-marketing/generated/contracts/notes-app.json`.
- `WidgetMode` is persisted with the snapshot, but the current widget list still renders from `snapshot.notes`; Glance-only preferences hold widget UI state like expansion plus category/tag filters.
- `parseLocalInputToIso(...)` and `isoToLocalInput(...)` define the expected `yyyy-MM-dd'T'HH:mm` editor format; keep note editors and API payloads aligned with these helpers.
- `headline()` and `descriptionBody()` intentionally split the first line from the rest of the note so list rows and widgets stay compact.

## Maintenance

Keep this file up to date after major changes in `app/src/main/java/com/eighthbrain/notesandroid/app/model`. Edit it when shared models, helper semantics, or persisted state shape changes.
