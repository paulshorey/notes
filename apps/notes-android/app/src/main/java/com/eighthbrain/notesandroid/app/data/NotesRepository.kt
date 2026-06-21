package com.eighthbrain.notesandroid.app.data

import android.content.Context
import com.eighthbrain.notesandroid.app.BuildConfig
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.CategoryRecord
import com.eighthbrain.notesandroid.app.model.TagRecord
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.UserSummary
import com.eighthbrain.notesandroid.app.model.WidgetMode
import com.eighthbrain.notesandroid.app.model.WorkflowStatusRecord
import com.eighthbrain.notesandroid.app.model.noteRecordToInput
import com.eighthbrain.notesandroid.app.widget.refreshWidgetsAfterSnapshotChange
import com.eighthbrain.notesandroid.app.work.WidgetRefreshScheduler
import kotlinx.coroutines.flow.Flow

class NotesRepository(
    context: Context,
    private val sessionStore: SessionStore = SessionStore(context.applicationContext),
    private val apiClient: NotesApiClient = NotesApiClient(),
) {
    private val appContext = context.applicationContext

    val snapshots: Flow<AppSnapshot> = sessionStore.snapshots

    suspend fun readSnapshot(): AppSnapshot = sessionStore.readSnapshot()

    suspend fun login(
        identifier: String,
        password: String,
    ): AppSnapshot =
        runWithErrorPersistence(readSnapshot()) { snapshot ->
            val baseUrl = BuildConfig.DEFAULT_API_BASE_URL
            val session = apiClient.login(baseUrl, identifier, password)
            val token = session.token
            val categories = apiClient.listCategories(baseUrl, token)
            val tags = apiClient.listTags(baseUrl, token)
            val notes = apiClient.listNotes(baseUrl, token)
            val workflowStatuses = apiClient.listWorkflowStatuses(baseUrl, token)
            val next =
                snapshot.copy(
                    user = session.user,
                    apiToken = token,
                    categories = categories,
                    tags = tags,
                    notes = notes,
                    workflowStatuses = workflowStatuses,
                    lastSearchQuery = "",
                    searchResults = emptyList(),
                    widgetMode = WidgetMode.NOTES,
                    lastSyncEpochMillis = System.currentTimeMillis(),
                    lastError = null,
                )
            persist(next)
            WidgetRefreshScheduler.schedule(appContext)
            next
        }

    suspend fun restoreSession(refreshSearch: Boolean = false): AppSnapshot {
        val snapshot = readSnapshot()
        if (snapshot.user == null) return snapshot
        if (snapshot.apiToken.isNullOrBlank()) {
            // Sessions persisted before token auth cannot call the API anymore;
            // drop them so the user signs in again and receives a token.
            return logout()
        }
        return syncSnapshot(snapshot, refreshSearch)
    }

    suspend fun refreshNotes(): AppSnapshot {
        val snapshot = readSnapshot()
        requireUser(snapshot)
        return syncSnapshot(snapshot, refreshSearch = false)
    }

    suspend fun createTag(label: String): TagRecord {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        val trimmed = label.trim()
        require(trimmed.isNotEmpty()) { "label is required." }
        return try {
            val tag = apiClient.createTag(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, trimmed)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
            tag
        } catch (error: Throwable) {
            persist(
                snapshot.copy(
                    lastError = error.message ?: "Unexpected request error.",
                ),
            )
            throw error
        }
    }

    suspend fun resolveTag(label: String): TagRecord {
        val snapshot = readSnapshot()
        snapshot.tags.findLabelMatch(label)?.let { return it }
        return createTag(label)
    }

    suspend fun createCategory(label: String): CategoryRecord {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        val trimmed = label.trim()
        require(trimmed.isNotEmpty()) { "label is required." }
        return try {
            val category = apiClient.createCategory(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, trimmed)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
            category
        } catch (error: Throwable) {
            persist(
                snapshot.copy(
                    lastError = error.message ?: "Unexpected request error.",
                ),
            )
            throw error
        }
    }

    suspend fun resolveCategory(label: String): CategoryRecord {
        val snapshot = readSnapshot()
        snapshot.categories.findLabelMatch(label)?.let { return it }
        return createCategory(label)
    }

    suspend fun updateCategory(
        categoryId: Int,
        label: String,
    ): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        val trimmed = label.trim()
        require(trimmed.isNotEmpty()) { "label is required." }
        return runWithErrorPersistence(snapshot) {
            apiClient.updateCategory(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, categoryId, trimmed)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun deleteCategory(categoryId: Int): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        return runWithErrorPersistence(snapshot) {
            apiClient.deleteCategory(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, categoryId)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun updateTag(
        tagId: Int,
        label: String,
    ): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        val trimmed = label.trim()
        require(trimmed.isNotEmpty()) { "label is required." }
        return runWithErrorPersistence(snapshot) {
            apiClient.updateTag(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, tagId, trimmed)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun deleteTag(tagId: Int): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        return runWithErrorPersistence(snapshot) {
            apiClient.deleteTag(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, tagId)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun saveNote(
        noteId: Int?,
        noteDraft: NoteDraft,
    ): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        return runWithErrorPersistence(snapshot) {
            var resolvedSnapshot = snapshot
            var resolvedDraft = noteDraft

            val categoryLabel = noteDraft.newCategoryLabel.trim()
            if (categoryLabel.isNotEmpty()) {
                val category = snapshot.categories.findLabelMatch(categoryLabel) ?: run {
                    val created = apiClient.createCategory(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, categoryLabel)
                    resolvedSnapshot = syncSnapshot(snapshot, refreshSearch = false)
                    created
                }
                resolvedDraft =
                    resolvedDraft.copy(
                        selectedCategoryId = category.id,
                        newCategoryLabel = "",
                    )
            }

            val extraTagLabel = noteDraft.newTagLabel.trim()
            if (extraTagLabel.isNotEmpty()) {
                val tag = resolvedSnapshot.tags.findLabelMatch(extraTagLabel) ?: run {
                    val created = apiClient.createTag(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, extraTagLabel)
                    resolvedSnapshot = syncSnapshot(resolvedSnapshot, refreshSearch = false)
                    created
                }
                resolvedDraft =
                    resolvedDraft.copy(
                        selectedTagIds =
                            if (resolvedDraft.selectedTagIds.contains(tag.id)) {
                                resolvedDraft.selectedTagIds
                            } else {
                                resolvedDraft.selectedTagIds + tag.id
                            },
                        newTagLabel = "",
                    )
            }

            require(resolvedDraft.selectedCategoryId != null) { "Choose or type a category before saving." }

            apiClient.saveNote(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, noteId, resolvedDraft)
            syncSnapshot(resolvedSnapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun setNoteWorkflowStatus(
        noteId: Int,
        workflowStatusId: Int?,
    ): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        val note =
            snapshot.notes.firstOrNull { it.id == noteId }
                ?: throw IllegalStateException("Note not found.")
        return runWithErrorPersistence(snapshot) {
            apiClient.patchNote(
                BuildConfig.DEFAULT_API_BASE_URL,
                token,
                user.id,
                noteId,
                noteRecordToInput(note, workflowStatusId = workflowStatusId),
            )
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun updateWorkflowStatusLabel(
        workflowStatusId: Int,
        label: String,
    ): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        val trimmed = label.trim()
        require(trimmed.isNotEmpty()) { "label is required." }
        return runWithErrorPersistence(snapshot) {
            apiClient.updateWorkflowStatus(
                BuildConfig.DEFAULT_API_BASE_URL,
                token,
                user.id,
                workflowStatusId,
                trimmed,
            )
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun deleteNote(noteId: Int): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        return runWithErrorPersistence(snapshot) {
            apiClient.deleteNote(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, noteId)
            syncSnapshot(snapshot, refreshSearch = snapshot.lastSearchQuery.isNotBlank())
        }
    }

    suspend fun search(query: String): AppSnapshot {
        val snapshot = readSnapshot()
        val user = requireUser(snapshot)
        val token = requireToken(snapshot)
        return runWithErrorPersistence(snapshot) {
            val trimmedQuery = query.trim()
            require(trimmedQuery.isNotEmpty()) { "Search query is required." }

            val results = apiClient.semanticSearch(BuildConfig.DEFAULT_API_BASE_URL, token, user.id, trimmedQuery)
            val next =
                snapshot.copy(
                    searchResults = results,
                    lastSearchQuery = trimmedQuery,
                    widgetMode = WidgetMode.SEARCH,
                    lastSyncEpochMillis = System.currentTimeMillis(),
                    lastError = null,
                )
            persist(next)
            next
        }
    }

    suspend fun setWidgetMode(mode: WidgetMode): AppSnapshot {
        val snapshot = readSnapshot()
        val next = snapshot.copy(widgetMode = mode, lastError = null)
        persist(next)
        return next
    }

    suspend fun clearSearch(): AppSnapshot {
        val snapshot = readSnapshot()
        val next =
            snapshot.copy(
                lastSearchQuery = "",
                searchResults = emptyList(),
                widgetMode = WidgetMode.NOTES,
                lastError = null,
            )
        persist(next)
        return next
    }

    suspend fun logout(): AppSnapshot {
        val snapshot = readSnapshot()
        val token = snapshot.apiToken
        if (!token.isNullOrBlank()) {
            // Best-effort server-side revocation; local sign-out proceeds regardless.
            runCatching { apiClient.logout(BuildConfig.DEFAULT_API_BASE_URL, token) }
        }
        val next = AppSnapshot()
        persist(next)
        WidgetRefreshScheduler.cancel(appContext)
        return next
    }

    suspend fun noteById(noteId: Int): NoteRecord? = readSnapshot().notes.firstOrNull { it.id == noteId }

    suspend fun tags(): List<TagRecord> = readSnapshot().tags

    suspend fun categories(): List<CategoryRecord> = readSnapshot().categories

    suspend fun workflowStatuses(): List<WorkflowStatusRecord> = readSnapshot().workflowStatuses

    private suspend fun syncSnapshot(
        snapshot: AppSnapshot,
        refreshSearch: Boolean,
    ): AppSnapshot =
        runWithErrorPersistence(snapshot) {
            val baseUrl = BuildConfig.DEFAULT_API_BASE_URL
            val token = requireToken(snapshot)
            val verifiedUser = apiClient.getUser(baseUrl, token)
            val categories = apiClient.listCategories(baseUrl, token)
            val tags = apiClient.listTags(baseUrl, token)
            val notes = apiClient.listNotes(baseUrl, token)
            val workflowStatuses = apiClient.listWorkflowStatuses(baseUrl, token)
            val results =
                if (refreshSearch && snapshot.lastSearchQuery.isNotBlank()) {
                    apiClient.semanticSearch(baseUrl, token, verifiedUser.id, snapshot.lastSearchQuery)
                } else {
                    snapshot.searchResults
                }

            val next =
                snapshot.copy(
                    user = verifiedUser,
                    categories = categories,
                    tags = tags,
                    notes = notes,
                    workflowStatuses = workflowStatuses,
                    searchResults = results,
                    lastSyncEpochMillis = System.currentTimeMillis(),
                    lastError = null,
                )
            persist(next)
            next
        }

    private suspend fun requireUser(snapshot: AppSnapshot): UserSummary =
        snapshot.user ?: throw IllegalStateException("Sign in before editing notes.")

    private fun requireToken(snapshot: AppSnapshot): String =
        snapshot.apiToken?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("Session expired. Sign in again.")

    private suspend fun runWithErrorPersistence(
        snapshot: AppSnapshot,
        block: suspend (AppSnapshot) -> AppSnapshot,
    ): AppSnapshot =
        try {
            block(snapshot)
        } catch (error: Throwable) {
            persist(
                snapshot.copy(
                    lastError = error.message ?: "Unexpected request error.",
                ),
            )
            throw error
        }

    private suspend fun persist(snapshot: AppSnapshot) {
        sessionStore.saveSnapshot(snapshot)
        val revision = snapshot.lastSyncEpochMillis ?: System.currentTimeMillis()
        refreshWidgetsAfterSnapshotChange(appContext, revision)
    }
}

private fun String.normalizedTaxonomyLabel(): String = trim().lowercase()

private fun List<CategoryRecord>.findLabelMatch(label: String): CategoryRecord? {
    val normalized = label.normalizedTaxonomyLabel()
    return firstOrNull { it.label.normalizedTaxonomyLabel() == normalized }
}

private fun List<TagRecord>.findLabelMatch(label: String): TagRecord? {
    val normalized = label.normalizedTaxonomyLabel()
    return firstOrNull { it.label.normalizedTaxonomyLabel() == normalized }
}
