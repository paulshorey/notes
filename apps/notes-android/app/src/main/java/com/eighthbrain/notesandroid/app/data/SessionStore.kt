package com.eighthbrain.notesandroid.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.WidgetMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.notesAndroidDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "notes_android_store",
)

private object PreferenceKeys {
    val userJson = stringPreferencesKey("user_json")
    val apiToken = stringPreferencesKey("api_token")
    val workspacesJson = stringPreferencesKey("workspaces_json")
    val activeWorkspaceId = intPreferencesKey("active_workspace_id")
    val categoriesJson = stringPreferencesKey("categories_json")
    val statusesJson = stringPreferencesKey("statuses_json")
    val tagsJson = stringPreferencesKey("tags_json")
    val notesJson = stringPreferencesKey("notes_json")
    val lastSearchQuery = stringPreferencesKey("last_search_query")
    val searchResultsJson = stringPreferencesKey("search_results_json")
    val widgetMode = stringPreferencesKey("widget_mode")
    val lastSyncEpochMillis = longPreferencesKey("last_sync_epoch_millis")
    val lastError = stringPreferencesKey("last_error")
}

class SessionStore(
    private val context: Context,
) {
    val snapshots: Flow<AppSnapshot> =
        context.notesAndroidDataStore.data.map { preferences ->
            preferences.toSnapshot()
        }

    suspend fun readSnapshot(): AppSnapshot = snapshots.first()

    suspend fun saveSnapshot(snapshot: AppSnapshot) {
        context.notesAndroidDataStore.edit { preferences ->
            if (snapshot.user == null) {
                preferences.remove(PreferenceKeys.userJson)
            } else {
                preferences[PreferenceKeys.userJson] = userToJson(snapshot.user).toString()
            }

            if (snapshot.apiToken.isNullOrBlank()) {
                preferences.remove(PreferenceKeys.apiToken)
            } else {
                preferences[PreferenceKeys.apiToken] = snapshot.apiToken
            }

            preferences[PreferenceKeys.workspacesJson] = workspacesToJson(snapshot.workspaces)
            if (snapshot.activeWorkspaceId == null) {
                preferences.remove(PreferenceKeys.activeWorkspaceId)
            } else {
                preferences[PreferenceKeys.activeWorkspaceId] = snapshot.activeWorkspaceId
            }
            preferences[PreferenceKeys.categoriesJson] = categoriesToJson(snapshot.categories)
            preferences[PreferenceKeys.statusesJson] = statusesToJson(snapshot.statuses)
            preferences[PreferenceKeys.tagsJson] = tagsToJson(snapshot.tags)
            preferences[PreferenceKeys.notesJson] = notesToJson(snapshot.notes)
            preferences[PreferenceKeys.lastSearchQuery] = snapshot.lastSearchQuery
            preferences[PreferenceKeys.searchResultsJson] = searchResultsToJson(snapshot.searchResults)
            preferences[PreferenceKeys.widgetMode] = snapshot.widgetMode.name

            if (snapshot.lastSyncEpochMillis == null) {
                preferences.remove(PreferenceKeys.lastSyncEpochMillis)
            } else {
                preferences[PreferenceKeys.lastSyncEpochMillis] = snapshot.lastSyncEpochMillis
            }

            if (snapshot.lastError.isNullOrBlank()) {
                preferences.remove(PreferenceKeys.lastError)
            } else {
                preferences[PreferenceKeys.lastError] = snapshot.lastError
            }
        }
    }

    private fun Preferences.toSnapshot(): AppSnapshot {
        val userJson = this[PreferenceKeys.userJson]
        val widgetMode =
            this[PreferenceKeys.widgetMode]
                ?.let {
                    runCatching { WidgetMode.valueOf(it) }.getOrDefault(WidgetMode.NOTES)
                }
                ?: WidgetMode.NOTES

        return AppSnapshot(
            user =
                userJson?.let { raw ->
                    runCatching { userFromJson(applyUserSummaryDefaults(JSONObject(raw))) }.getOrNull()
                },
            apiToken = this[PreferenceKeys.apiToken],
            workspaces =
                runCatching { workspacesFromJson(this[PreferenceKeys.workspacesJson]) }
                    .getOrDefault(emptyList()),
            activeWorkspaceId = this[PreferenceKeys.activeWorkspaceId],
            categories =
                runCatching { categoriesFromJson(this[PreferenceKeys.categoriesJson]) }
                    .getOrDefault(emptyList()),
            statuses =
                runCatching { statusesFromJson(this[PreferenceKeys.statusesJson]) }
                    .getOrDefault(emptyList()),
            tags = runCatching { tagsFromJson(this[PreferenceKeys.tagsJson]) }.getOrDefault(emptyList()),
            notes = runCatching { notesFromJson(this[PreferenceKeys.notesJson]) }.getOrDefault(emptyList()),
            lastSearchQuery = this[PreferenceKeys.lastSearchQuery].orEmpty(),
            searchResults =
                runCatching { searchResultsFromJson(this[PreferenceKeys.searchResultsJson]) }
                    .getOrDefault(emptyList()),
            widgetMode = widgetMode,
            lastSyncEpochMillis = this[PreferenceKeys.lastSyncEpochMillis],
            lastError = this[PreferenceKeys.lastError],
        )
    }
}
