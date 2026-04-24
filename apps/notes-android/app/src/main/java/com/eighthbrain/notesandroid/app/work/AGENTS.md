# `work`

Background refresh for the home-screen widget.

## Files

- `WidgetRefreshWorker.kt` - WorkManager worker that restores the saved session when a user is signed in; retries on failure.
- `WidgetRefreshScheduler.kt` - schedules or cancels a single named periodic job with a connected-network constraint.

## Non-obvious rules

- Periodic refresh is for widget freshness, not for live push-style sync.
- The worker uses `restoreSession(refreshSearch = false)`, so periodic refresh updates notes/tags/user but does not rerun semantic search.
- Scheduling happens on login and cancellation happens on logout through `NotesRepository`.

## Maintenance

Keep this file up to date after major changes in `work`. Edit it when background scheduling policy, worker behavior, or file responsibilities change.
