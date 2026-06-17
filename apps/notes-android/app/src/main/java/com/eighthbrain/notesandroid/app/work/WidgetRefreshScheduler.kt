package com.eighthbrain.notesandroid.app.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object WidgetRefreshScheduler {
    private const val workName = "notes_widget_refresh"
    private const val oneShotWorkName = "notes_widget_refresh_now"

    /**
     * Enqueues a single immediate refresh, used when the widget is (re)rendered so its
     * content is pulled fresh "when the user looks at the widget". [ExistingWorkPolicy.KEEP]
     * throttles bursts of widget updates into one in-flight refresh at a time. An auth
     * failure during the refresh causes [NotesRepository] to clear the session, so the
     * widget recomposes into its "Sign in" state.
     */
    fun refreshNow(context: Context) {
        val request =
            OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            oneShotWorkName,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun schedule(context: Context) {
        val request =
            PeriodicWorkRequestBuilder<WidgetRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            workName,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(workName)
    }
}
