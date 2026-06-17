package com.eighthbrain.notesandroid.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.data.AuthenticationException

class WidgetRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as NotesApplication).repository
        val snapshot = repository.readSnapshot()

        if (snapshot.user == null) {
            return Result.success()
        }

        return try {
            repository.restoreSession(refreshSearch = false)
            Result.success()
        } catch (_: AuthenticationException) {
            // The repository already cleared the session, so the widget now shows
            // "Sign in". Retrying would not help, so treat this as handled.
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
