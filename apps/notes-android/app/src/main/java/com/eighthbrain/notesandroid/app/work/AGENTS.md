# `work`

Background refresh for the home-screen widget.

## Files

- `WidgetRefreshWorker.kt` - WorkManager worker that restores the saved session when a user is signed in; retries on generic failure, but treats `AuthenticationException` as handled (the repository already cleared the session, so the widget shows `Sign in`).
- `WidgetRefreshScheduler.kt` - schedules/cancels the named periodic job and exposes `refreshNow(...)`, a one-shot unique (`KEEP`) refresh; both use a connected-network constraint.

## Non-obvious rules

- Periodic refresh is for widget freshness, not for live push-style sync.
- `refreshNow(...)` is enqueued from `NotesHomeWidget.provideGlance` so content is pulled "when the user looks at the widget"; `ExistingWorkPolicy.KEEP` throttles bursts of widget updates into one in-flight refresh.
- The worker uses `restoreSession(refreshSearch = false)`, so refresh updates notes/tags/user but does not rerun semantic search.
- Scheduling happens on login and cancellation happens on logout/auth-failure through `NotesRepository`.

## Maintenance

Keep this file up to date after major changes in `work`. Edit it when background scheduling policy, worker behavior, or file responsibilities change.
