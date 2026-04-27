package com.eighthbrain.notesandroid.app.ui

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.model.AppSnapshot
import com.eighthbrain.notesandroid.app.model.CategoryRecord
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.TagRecord
import com.eighthbrain.notesandroid.app.model.defaultDueInput
import com.eighthbrain.notesandroid.app.model.defaultRemindInput
import com.eighthbrain.notesandroid.app.model.descriptionBody
import com.eighthbrain.notesandroid.app.model.formatConciseDate
import com.eighthbrain.notesandroid.app.model.formatPercent
import com.eighthbrain.notesandroid.app.model.headline
import com.eighthbrain.notesandroid.app.model.sortedByLastUpdatedDescending
import com.eighthbrain.notesandroid.app.model.toDraft
import com.eighthbrain.notesandroid.app.widget.clearWidgetExpandedStateForNote
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId

data class DisplayItem(
    val note: NoteRecord,
    val relevance: Double? = null,
)

data class NotesUiState(
    val snapshot: AppSnapshot = AppSnapshot(),
    val identifier: String = "",
    val noteDraft: NoteDraft = NoteDraft(),
    val editingNoteId: Int? = null,
    val searchQuery: String = "",
    val expandedNoteIds: Set<Int> = emptySet(),
    val showNoteEditor: Boolean = false,
    val searchLoading: Boolean = false,
    val isBusy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val selectedCategoryId: Int? = null,
    val editingCategoryId: Int? = null,
    val editingCategoryLabel: String = "",
    val deletingCategoryId: Int? = null,
    val selectedTagId: Int? = null,
    val editingTagId: Int? = null,
    val editingTagLabel: String = "",
    val deletingTagId: Int? = null,
)

private data class LaunchRequest(
    val action: String,
    val noteId: Int? = null,
    val focusSearch: Boolean = false,
) {
    companion object {
        fun fromIntent(intent: Intent?): LaunchRequest? {
            if (intent == null) {
                return null
            }
            if (intent.action == Intent.ACTION_VIEW) {
                val uri: Uri = intent.data ?: return null
                if (uri.scheme == MainActivity.deepLinkScheme && uri.host == MainActivity.deepLinkHostSearch) {
                    return LaunchRequest(
                        action = MainActivity.launchActionSearch,
                        noteId = null,
                        focusSearch = true,
                    )
                }
                return null
            }
            val action = intent.getStringExtra(MainActivity.extraLaunchAction) ?: return null
            val noteId = intent.getIntExtra(MainActivity.extraLaunchNoteId, -1).takeIf { it > 0 }
            val focusSearch = intent.getBooleanExtra(MainActivity.extraLaunchFocusSearch, false)
            return LaunchRequest(action = action, noteId = noteId, focusSearch = focusSearch)
        }
    }
}

class NotesViewModel(
    application: Application,
) : AndroidViewModel(application) {
    private val repository = (application as NotesApplication).repository
    private val _uiState = MutableStateFlow(NotesUiState())
    val uiState: StateFlow<NotesUiState> = _uiState.asStateFlow()
    private var searchJob: Job? = null

    init {
        viewModelScope.launch {
            repository.snapshots.collect { snapshot ->
                _uiState.update { current ->
                    current.copy(
                        snapshot = snapshot,
                        searchQuery =
                            if (current.searchQuery.isBlank()) snapshot.lastSearchQuery else current.searchQuery,
                    )
                }
            }
        }

        viewModelScope.launch {
            if (repository.readSnapshot().user != null) {
                runAction(errorPrefix = "Unable to refresh saved session.") {
                    val snapshot = repository.restoreSession(refreshSearch = false)
                    _uiState.update {
                        it.copy(
                            message = notesSortMessage(snapshot.lastSearchQuery),
                            error = null,
                        )
                    }
                }
            }
        }
    }

    fun updateIdentifier(value: String) {
        _uiState.update { it.copy(identifier = value) }
    }

    fun updateSearchQuery(value: String) {
        _uiState.update { it.copy(searchQuery = value, error = null) }
        debouncedSearch()
    }

    fun updateNewTagLabel(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(newTagLabel = value)) }
    }

    fun updateNewCategoryLabel(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(newCategoryLabel = value)) }
    }

    fun selectDraftCategory(categoryId: Int) {
        val category = _uiState.value.snapshot.categories.firstOrNull { it.id == categoryId }
        _uiState.update {
            it.copy(
                noteDraft =
                    it.noteDraft.copy(
                        selectedCategoryId = categoryId,
                        newCategoryLabel = category?.label ?: it.noteDraft.newCategoryLabel,
                    ),
            )
        }
    }

    fun appendTagId(id: Int) {
        _uiState.update { state ->
            val ids = state.noteDraft.selectedTagIds
            if (ids.contains(id)) {
                state
            } else {
                state.copy(
                    noteDraft =
                        state.noteDraft.copy(
                            selectedTagIds = ids + id,
                            newTagLabel = "",
                        ),
                )
            }
        }
    }

    fun removeTagId(id: Int) {
        _uiState.update {
            it.copy(
                noteDraft =
                    it.noteDraft.copy(
                        selectedTagIds = it.noteDraft.selectedTagIds.filter { x -> x != id },
                    ),
            )
        }
    }

    fun createTagFromInput() {
        val current = uiState.value
        val label = current.noteDraft.newTagLabel.trim()
        if (label.isEmpty()) {
            return
        }
        runAction {
            val tag = repository.resolveTag(label)
            _uiState.update {
                it.copy(
                    noteDraft =
                        it.noteDraft.copy(
                            newTagLabel = "",
                            selectedTagIds =
                                if (it.noteDraft.selectedTagIds.contains(tag.id)) {
                                    it.noteDraft.selectedTagIds
                                } else {
                                    it.noteDraft.selectedTagIds + tag.id
                                },
                        ),
                    message = "Tag \"${tag.label}\" added.",
                    error = null,
                )
            }
        }
    }

    fun createCategoryFromInput() {
        val current = uiState.value
        val label = current.noteDraft.newCategoryLabel.trim()
        if (label.isEmpty()) {
            return
        }
        runAction {
            val category = repository.resolveCategory(label)
            _uiState.update {
                it.copy(
                    noteDraft =
                        it.noteDraft.copy(
                            newCategoryLabel = "",
                            selectedCategoryId = category.id,
                        ),
                    message = "Category \"${category.label}\" added.",
                    error = null,
                )
            }
        }
    }

    fun updateNoteDescription(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(description = value)) }
    }

    fun updateDueInput(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(dueInput = value)) }
    }

    fun updateRemindInput(value: String) {
        _uiState.update { it.copy(noteDraft = it.noteDraft.copy(remindInput = value)) }
    }

    fun expandDueInput() {
        _uiState.update {
            it.copy(
                noteDraft =
                    it.noteDraft.copy(
                        dueExpanded = true,
                        dueInput = it.noteDraft.dueInput ?: defaultDueInput(),
                    ),
            )
        }
    }

    fun expandRemindInput() {
        _uiState.update {
            it.copy(
                noteDraft =
                    it.noteDraft.copy(
                        remindExpanded = true,
                        remindInput = it.noteDraft.remindInput ?: defaultRemindInput(),
                    ),
            )
        }
    }

    fun toggleNoteExpanded(noteId: Int) {
        _uiState.update { state ->
            val ids = state.expandedNoteIds.toMutableSet()
            if (noteId in ids) ids.remove(noteId) else ids.add(noteId)
            state.copy(expandedNoteIds = ids)
        }
    }

    fun signIn() {
        val current = uiState.value
        runAction {
            val snapshot = repository.login(current.identifier)
            _uiState.update {
                it.copy(
                    identifier = "",
                    noteDraft = NoteDraft(),
                    editingNoteId = null,
                    searchQuery = "",
                    message = "Signed in as ${snapshot.user?.username}.",
                    error = null,
                )
            }
        }
    }

    fun signOut() {
        searchJob?.cancel()
        runAction {
            repository.logout()
            _uiState.update {
                it.copy(
                    noteDraft = NoteDraft(),
                    editingNoteId = null,
                    searchQuery = "",
                    expandedNoteIds = emptySet(),
                    message = "Signed out.",
                    error = null,
                )
            }
        }
    }

    fun refreshNotes() {
        runAction {
            val hasActiveSearch = _uiState.value.searchQuery.trim().isNotEmpty()
            val snapshot = repository.restoreSession(refreshSearch = hasActiveSearch)
            _uiState.update {
                it.copy(
                    message = notesSortMessage(snapshot.lastSearchQuery),
                    error = null,
                )
            }
        }
    }

    fun startEditing(note: NoteRecord) {
        _uiState.update {
            it.copy(
                noteDraft = note.toDraft(),
                editingNoteId = note.id,
                showNoteEditor = true,
                message = null,
                error = null,
            )
        }
    }

    fun cancelEditing() {
        _uiState.update {
            it.copy(
                noteDraft = NoteDraft(),
                editingNoteId = null,
                showNoteEditor = false,
                message = null,
                error = null,
            )
        }
    }

    fun showNoteEditor() {
        val defaultCategory = _uiState.value.snapshot.categories.minByOrNull { it.id }
        _uiState.update {
            it.copy(
                showNoteEditor = true,
                noteDraft =
                    NoteDraft(
                        selectedCategoryId = defaultCategory?.id,
                        newCategoryLabel = defaultCategory?.label.orEmpty(),
                    ),
            )
        }
    }

    fun saveNote() {
        val current = uiState.value
        if (current.noteDraft.selectedCategoryId == null && current.noteDraft.newCategoryLabel.trim().isEmpty()) {
            _uiState.update { it.copy(error = "Choose or type a category before saving.") }
            return
        }
        runAction {
            repository.saveNote(current.editingNoteId, current.noteDraft)
            _uiState.update {
                it.copy(
                    noteDraft = NoteDraft(),
                    editingNoteId = null,
                    showNoteEditor = false,
                    message = if (current.editingNoteId == null) "Note created." else "Note updated.",
                    error = null,
                )
            }
        }
    }

    fun selectTagFilter(tagId: Int?) {
        _uiState.update { it.copy(selectedTagId = tagId) }
    }

    fun selectCategoryFilter(categoryId: Int?) {
        _uiState.update { it.copy(selectedCategoryId = categoryId) }
    }

    fun startEditingCategory(categoryId: Int) {
        val current = _uiState.value
        val category = current.snapshot.categories.firstOrNull { it.id == categoryId } ?: return
        _uiState.update {
            it.copy(
                editingCategoryId = category.id,
                editingCategoryLabel = category.label,
                error = null,
            )
        }
    }

    fun updateEditingCategoryLabel(value: String) {
        _uiState.update { it.copy(editingCategoryLabel = value) }
    }

    fun cancelEditingCategory() {
        _uiState.update { it.copy(editingCategoryId = null, editingCategoryLabel = "") }
    }

    fun saveEditingCategory() {
        val current = _uiState.value
        val categoryId = current.editingCategoryId ?: return
        val label = current.editingCategoryLabel.trim()
        if (label.isEmpty()) return
        runAction {
            repository.updateCategory(categoryId, label)
            _uiState.update {
                it.copy(
                    editingCategoryId = null,
                    editingCategoryLabel = "",
                    message = "Category renamed.",
                    error = null,
                )
            }
        }
    }

    fun startDeletingCategory(categoryId: Int) {
        val current = _uiState.value
        val category = current.snapshot.categories.firstOrNull { it.id == categoryId } ?: return
        val fallbackId = current.snapshot.categories.minByOrNull { it.id }?.id
        if (categoryId == fallbackId) {
            _uiState.update { it.copy(error = "The default category cannot be deleted.") }
            return
        }
        if (current.snapshot.categories.size <= 1) {
            _uiState.update {
                it.copy(error = "Create another category before deleting the last one.")
            }
            return
        }
        if (category.noteCount == 0) {
            runAction {
                repository.deleteCategory(categoryId)
                _uiState.update {
                    it.copy(
                        deletingCategoryId = null,
                        selectedCategoryId =
                            if (it.selectedCategoryId == categoryId) null else it.selectedCategoryId,
                        message = "Category deleted.",
                        error = null,
                    )
                }
            }
        } else {
            _uiState.update { it.copy(deletingCategoryId = categoryId, error = null) }
        }
    }

    fun cancelDeletingCategory() {
        _uiState.update { it.copy(deletingCategoryId = null) }
    }

    fun confirmDeleteCategory() {
        val current = _uiState.value
        val categoryId = current.deletingCategoryId ?: return
        runAction {
            repository.deleteCategory(categoryId)
            _uiState.update {
                it.copy(
                    deletingCategoryId = null,
                    selectedCategoryId =
                        if (it.selectedCategoryId == categoryId) null else it.selectedCategoryId,
                    message = "Category deleted.",
                    error = null,
                )
            }
        }
    }

    fun startEditingTag(tagId: Int) {
        val current = _uiState.value
        val tag = current.snapshot.tags.firstOrNull { it.id == tagId } ?: return
        _uiState.update {
            it.copy(
                editingTagId = tag.id,
                editingTagLabel = tag.label,
                error = null,
            )
        }
    }

    fun updateEditingTagLabel(value: String) {
        _uiState.update { it.copy(editingTagLabel = value) }
    }

    fun cancelEditingTag() {
        _uiState.update { it.copy(editingTagId = null, editingTagLabel = "") }
    }

    fun saveEditingTag() {
        val current = _uiState.value
        val tagId = current.editingTagId ?: return
        val label = current.editingTagLabel.trim()
        if (label.isEmpty()) return
        runAction {
            repository.updateTag(tagId, label)
            _uiState.update {
                it.copy(
                    editingTagId = null,
                    editingTagLabel = "",
                    message = "Tag renamed.",
                    error = null,
                )
            }
        }
    }

    fun startDeletingTag(tagId: Int) {
        val current = _uiState.value
        val tag = current.snapshot.tags.firstOrNull { it.id == tagId } ?: return
        if (tag.noteCount == 0) {
            runAction {
                repository.deleteTag(tagId)
                _uiState.update {
                    it.copy(
                        deletingTagId = null,
                        selectedTagId =
                            if (it.selectedTagId == tagId) null else it.selectedTagId,
                        message = "Tag deleted.",
                        error = null,
                    )
                }
            }
        } else {
            _uiState.update { it.copy(deletingTagId = tagId, error = null) }
        }
    }

    fun cancelDeletingTag() {
        _uiState.update { it.copy(deletingTagId = null) }
    }

    fun confirmDeleteTag() {
        val current = _uiState.value
        val tagId = current.deletingTagId ?: return
        runAction {
            repository.deleteTag(tagId)
            _uiState.update {
                it.copy(
                    deletingTagId = null,
                    selectedTagId = if (it.selectedTagId == tagId) null else it.selectedTagId,
                    message = "Tag deleted.",
                    error = null,
                )
            }
        }
    }

    fun deleteNote(noteId: Int) {
        val current = uiState.value
        runAction {
            repository.deleteNote(noteId)
            _uiState.update {
                it.copy(
                    noteDraft = if (current.editingNoteId == noteId) NoteDraft() else it.noteDraft,
                    editingNoteId = if (current.editingNoteId == noteId) null else it.editingNoteId,
                    message = "Note deleted.",
                    error = null,
                )
            }
        }
    }

    private fun debouncedSearch() {
        searchJob?.cancel()
        val state = _uiState.value
        val query = state.searchQuery.trim()
        state.snapshot.user ?: return

        if (query.isEmpty()) {
            viewModelScope.launch {
                try {
                    repository.clearSearch()
                    _uiState.update {
                        it.copy(
                            message = notesSortMessage(""),
                            error = null,
                        )
                    }
                } catch (_: Exception) {}
            }
            _uiState.update { it.copy(searchLoading = false) }
            return
        }

        searchJob = viewModelScope.launch {
            delay(250)
            _uiState.update { it.copy(searchLoading = true) }
            try {
                repository.search(query)
                _uiState.update {
                    it.copy(
                        message = notesSortMessage(query),
                        error = null,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (error: Exception) {
                _uiState.update { it.copy(error = error.message) }
            } finally {
                _uiState.update { it.copy(searchLoading = false) }
            }
        }
    }

    private fun runAction(
        errorPrefix: String? = null,
        action: suspend () -> Unit,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isBusy = true, error = null) }
            try {
                action()
            } catch (e: CancellationException) {
                throw e
            } catch (error: Exception) {
                val message = error.message ?: "Unexpected request error."
                _uiState.update {
                    it.copy(
                        error = errorPrefix?.let { prefix -> "$prefix $message" } ?: message,
                        message = null,
                    )
                }
            } finally {
                _uiState.update { it.copy(isBusy = false) }
            }
        }
    }

    companion object {
        fun factory(application: Application) =
            viewModelFactory {
                initializer {
                    NotesViewModel(application)
                }
            }
    }
}

private fun notesSortMessage(query: String): String =
    if (query.trim().isNotEmpty()) {
        "Notes sorted by meaning"
    } else {
        "Notes sorted by last updated"
    }

class MainActivity : ComponentActivity() {
    private var launchRequest by mutableStateOf<LaunchRequest?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launchRequest = LaunchRequest.fromIntent(intent)
        setContent {
            NotesTheme {
                val viewModel: NotesViewModel =
                    viewModel(factory = NotesViewModel.factory(application))
                val uiState by viewModel.uiState.collectAsState()
                var searchFocusNonce by remember { mutableStateOf(0) }
                NotesAppScreen(
                    uiState = uiState,
                    viewModel = viewModel,
                    launchRequest = launchRequest,
                    onLaunchHandled = { launchRequest = null },
                    searchFocusNonce = searchFocusNonce,
                    onRequestSearchFieldFocus = { searchFocusNonce++ },
                    appContext = applicationContext,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        launchRequest = LaunchRequest.fromIntent(intent)
    }

    companion object {
        const val extraLaunchAction = "launch_action"
        const val extraLaunchNoteId = "launch_note_id"
        const val extraLaunchFocusSearch = "launch_focus_search"
        const val launchActionAdd = "add"
        const val launchActionEdit = "edit"
        const val launchActionDelete = "delete"
        const val launchActionSearch = "search"

        /** Custom scheme for in-app deep links (e.g. `notes-android://search`). */
        const val deepLinkScheme = "notes-android"

        const val deepLinkHostSearch = "search"

        fun createLaunchIntent(
            context: Context,
            action: String? = null,
            noteId: Int? = null,
            focusSearch: Boolean = false,
        ): Intent =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                action?.let { putExtra(extraLaunchAction, it) }
                noteId?.let { putExtra(extraLaunchNoteId, it) }
                if (focusSearch) {
                    putExtra(extraLaunchFocusSearch, true)
                }
            }
    }
}

@Composable
private fun NotesAppScreen(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
    launchRequest: LaunchRequest?,
    onLaunchHandled: () -> Unit,
    searchFocusNonce: Int,
    onRequestSearchFieldFocus: () -> Unit,
    appContext: Context,
) {
    LaunchedEffect(launchRequest, uiState.snapshot.user, uiState.snapshot.notes) {
        if (launchRequest == null || uiState.snapshot.user == null) {
            return@LaunchedEffect
        }

        when (launchRequest.action) {
            MainActivity.launchActionAdd -> {
                viewModel.showNoteEditor()
                onLaunchHandled()
            }

            MainActivity.launchActionEdit -> {
                val note = launchRequest.noteId?.let { noteId ->
                    uiState.snapshot.notes.firstOrNull { it.id == noteId }
                }
                if (note != null) {
                    viewModel.startEditing(note)
                    onLaunchHandled()
                }
            }

            MainActivity.launchActionDelete -> {
                val noteId = launchRequest.noteId
                if (noteId == null) {
                    onLaunchHandled()
                    return@LaunchedEffect
                }
                if (uiState.snapshot.notes.none { it.id == noteId }) {
                    onLaunchHandled()
                    return@LaunchedEffect
                }
                clearWidgetExpandedStateForNote(appContext, noteId)
                viewModel.deleteNote(noteId)
                onLaunchHandled()
            }

            MainActivity.launchActionSearch -> {
                if (launchRequest.focusSearch) {
                    onRequestSearchFieldFocus()
                }
                onLaunchHandled()
            }

            else -> onLaunchHandled()
        }
    }

    if (uiState.snapshot.user == null) {
        LoginScreen(uiState = uiState, viewModel = viewModel)
    } else {
        MainContent(
            uiState = uiState,
            viewModel = viewModel,
            searchFocusNonce = searchFocusNonce,
        )
    }
}

@Composable
private fun LoginScreen(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Notes", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = uiState.identifier,
            onValueChange = viewModel::updateIdentifier,
            placeholder = { Text("Username, email, or phone") },
            modifier = Modifier.fillMaxWidth(0.85f),
            singleLine = true,
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = viewModel::signIn,
            modifier = Modifier.fillMaxWidth(0.85f),
            enabled = !uiState.isBusy,
        ) {
            Text("Sign in")
        }
        if (uiState.isBusy) {
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(0.85f))
        }
        uiState.error?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun MainContent(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
    searchFocusNonce: Int,
) {
    val user = uiState.snapshot.user ?: return
    val searchFieldFocusRequester = remember { FocusRequester() }
    LaunchedEffect(searchFocusNonce) {
        if (searchFocusNonce > 0) {
            searchFieldFocusRequester.requestFocus()
        }
    }
    val searchMode = uiState.searchQuery.trim().isNotEmpty()
    val isLoading = if (searchMode) uiState.searchLoading || uiState.isBusy else uiState.isBusy

    val selectedCategoryId = uiState.selectedCategoryId
    val selectedTagId = uiState.selectedTagId
    val displayItems =
        remember(
            uiState.snapshot.notes,
            uiState.snapshot.searchResults,
            searchMode,
            selectedCategoryId,
            selectedTagId,
        ) {
            val matchesCategory: (NoteRecord) -> Boolean = { note ->
                selectedCategoryId == null || note.category.id == selectedCategoryId
            }
            val matchesTag: (NoteRecord) -> Boolean = { note ->
                selectedTagId == null ||
                    note.tags.any { it.id == selectedTagId }
            }
            if (searchMode) {
                uiState.snapshot.searchResults
                    .filter { matchesCategory(it.note) && matchesTag(it.note) }
                    .sortedByDescending { it.similarity }
                    .map { DisplayItem(note = it.note, relevance = it.similarity) }
            } else {
                uiState.snapshot.notes
                    .filter { matchesCategory(it) && matchesTag(it) }
                    .sortedByLastUpdatedDescending()
                    .map { DisplayItem(note = it) }
            }
        }

    val selectedCategory = uiState.snapshot.categories.firstOrNull { it.id == selectedCategoryId }
    val selectedTag = uiState.snapshot.tags.firstOrNull { it.id == selectedTagId }

    var showCategoryPicker by remember { mutableStateOf(false) }
    var showTagPicker by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = viewModel::refreshNotes, enabled = !uiState.isBusy) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "Refresh",
                        modifier = Modifier.size(20.dp),
                    )
                }
                Box {
                    var showMenu by remember { mutableStateOf(false) }
                    IconButton(onClick = { showMenu = true }) {
                        Icon(
                            Icons.Default.Person,
                            contentDescription = "Account",
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false },
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Text(user.username, style = MaterialTheme.typography.bodyMedium)
                            user.email?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            user.phone?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("Sign out", color = MaterialTheme.colorScheme.error) },
                            onClick = {
                                showMenu = false
                                viewModel.signOut()
                            },
                        )
                    }
                }
            }

            if (isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            val displayError = uiState.error ?: uiState.snapshot.lastError
            if (uiState.message != null || displayError != null) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp)) {
                    uiState.message?.let {
                        Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                    }
                    displayError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            TagSelectField(
                selectedLabel = selectedCategory?.label,
                allLabel = "All categories",
                onClick = { showCategoryPicker = true },
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
            )

            TagSelectField(
                selectedLabel = selectedTag?.label,
                allLabel = "All tags",
                onClick = { showTagPicker = true },
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
            )

            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = viewModel::updateSearchQuery,
                    placeholder = { Text("Search notes by meaning") },
                    trailingIcon = {
                        if (uiState.searchQuery.isNotEmpty()) {
                            IconButton(onClick = { viewModel.updateSearchQuery("") }) {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = "Clear search",
                                )
                            }
                        }
                    },
                    modifier =
                        Modifier
                            .focusRequester(searchFieldFocusRequester)
                            .weight(1f),
                    singleLine = true,
                )
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 80.dp),
            ) {
                if (displayItems.isEmpty() && !isLoading) {
                    item {
                        Text(
                            if (searchMode) "No close matches found." else "No notes yet.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
                        )
                    }
                } else {
                    items(displayItems, key = { it.note.id }) { item ->
                        NoteItem(
                            item = item,
                            isExpanded = item.note.id in uiState.expandedNoteIds,
                            onToggle = { viewModel.toggleNoteExpanded(item.note.id) },
                            onEdit = { viewModel.startEditing(item.note) },
                            onDelete = { viewModel.deleteNote(item.note.id) },
                        )
                    }
                }
            }
        }

        Row(
            modifier =
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(16.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            FloatingActionButton(
                onClick = viewModel::showNoteEditor,
                shape = CircleShape,
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add note")
            }
        }

        NoteEditorModal(uiState = uiState, viewModel = viewModel)
    }

    if (showCategoryPicker) {
        CategoriesPickerDialog(
            uiState = uiState,
            viewModel = viewModel,
            onDismiss = {
                viewModel.cancelEditingCategory()
                viewModel.cancelDeletingCategory()
                showCategoryPicker = false
            },
        )
    }

    if (showTagPicker) {
        TagsPickerDialog(
            uiState = uiState,
            viewModel = viewModel,
            onDismiss = {
                viewModel.cancelEditingTag()
                viewModel.cancelDeletingTag()
                showTagPicker = false
            },
        )
    }
}

@Composable
private fun TagSelectField(
    selectedLabel: String?,
    allLabel: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        onClick = onClick,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = selectedLabel ?: allLabel,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
                overflow = TextOverflow.Ellipsis,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Default.ArrowDropDown,
                contentDescription = "Open tags",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CategoriesPickerDialog(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 32.dp),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Categories",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                CategoriesPopupList(
                    categories = uiState.snapshot.categories,
                    totalNoteCount = uiState.snapshot.notes.size,
                    selectedCategoryId = uiState.selectedCategoryId,
                    editingCategoryId = uiState.editingCategoryId,
                    editingDraft = uiState.editingCategoryLabel,
                    deletingCategoryId = uiState.deletingCategoryId,
                    protectedCategoryId = uiState.snapshot.categories.minByOrNull { it.id }?.id,
                    busy = uiState.isBusy,
                    onSelect = { id ->
                        viewModel.selectCategoryFilter(id)
                        onDismiss()
                    },
                    onStartEdit = { category -> viewModel.startEditingCategory(category.id) },
                    onEditDraftChange = viewModel::updateEditingCategoryLabel,
                    onSaveEdit = viewModel::saveEditingCategory,
                    onCancelEdit = viewModel::cancelEditingCategory,
                    onStartDelete = { category -> viewModel.startDeletingCategory(category.id) },
                    onConfirmDelete = viewModel::confirmDeleteCategory,
                    onCancelDelete = viewModel::cancelDeletingCategory,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun TagsPickerDialog(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 32.dp),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Tags",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                TagsPopupList(
                    tags = uiState.snapshot.tags,
                    totalNoteCount = uiState.snapshot.notes.size,
                    selectedTagId = uiState.selectedTagId,
                    editingTagId = uiState.editingTagId,
                    editingDraft = uiState.editingTagLabel,
                    deletingTagId = uiState.deletingTagId,
                    busy = uiState.isBusy,
                    onSelect = { id ->
                        viewModel.selectTagFilter(id)
                        onDismiss()
                    },
                    onStartEdit = { tag -> viewModel.startEditingTag(tag.id) },
                    onEditDraftChange = viewModel::updateEditingTagLabel,
                    onSaveEdit = viewModel::saveEditingTag,
                    onCancelEdit = viewModel::cancelEditingTag,
                    onStartDelete = { tag -> viewModel.startDeletingTag(tag.id) },
                    onConfirmDelete = viewModel::confirmDeleteTag,
                    onCancelDelete = viewModel::cancelDeletingTag,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun NoteItem(
    item: DisplayItem,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.align(Alignment.TopEnd),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                item.relevance?.let { rel ->
                    Text(
                        text = formatPercent(rel),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
                IconButton(onClick = onEdit, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = "Edit",
                        modifier = Modifier.size(16.dp),
                    )
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Delete",
                        modifier = Modifier.size(16.dp),
                    )
                }
            }

            val actionCount = 2 + if (item.relevance != null) 1 else 0
            val reservedEnd = (actionCount * 34).dp
            Text(
                text = item.note.headline(),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = if (isExpanded) Int.MAX_VALUE else 1,
                overflow = TextOverflow.Ellipsis,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(end = reservedEnd, top = 6.dp),
            )
        }

        if (isExpanded) {
            val bodyText = item.note.descriptionBody()
            if (bodyText.isNotBlank()) {
                Text(
                    text = bodyText,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (item.note.tags.isNotEmpty()) {
                FlowRow(
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item.note.tags.forEach { cat ->
                        Text(
                            text = "• ${cat.label}",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            val dateLabels =
                listOfNotNull(
                    item.note.timeDue?.let { "Due ${formatConciseDate(it)}" },
                    item.note.timeRemind?.let { "Remind ${formatConciseDate(it)}" },
                )
            if (dateLabels.isNotEmpty()) {
                Text(
                    dateLabels.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }

    HorizontalDivider(
        modifier = Modifier.padding(horizontal = 12.dp),
        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
    )
}

@Composable
private fun NoteEditorModal(
    uiState: NotesUiState,
    viewModel: NotesViewModel,
) {
    AnimatedVisibility(
        visible = uiState.showNoteEditor,
        enter =
            slideInVertically(
                animationSpec = tween(350),
                initialOffsetY = { it },
            ),
        exit =
            slideOutVertically(
                animationSpec = tween(350),
                targetOffsetY = { it },
            ),
    ) {
        Surface(
            modifier =
                Modifier
                    .fillMaxSize()
                    .pointerInput(uiState.showNoteEditor) {
                        var totalDrag = 0f
                        detectVerticalDragGestures(
                            onDragStart = { totalDrag = 0f },
                            onDragEnd = {
                                if (totalDrag > 180f) {
                                    viewModel.cancelEditing()
                                }
                            },
                            onVerticalDrag = { _, dy ->
                                totalDrag += dy
                            },
                        )
                    },
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(start = 20.dp, end = 8.dp, top = 32.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (uiState.editingNoteId == null) "New note" else "Edit note",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                    IconButton(onClick = viewModel::cancelEditing) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }

                Column(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedTextField(
                        value = uiState.noteDraft.description,
                        onValueChange = viewModel::updateNoteDescription,
                        placeholder = { Text("Description") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 4,
                    )
                    CategoryComboField(
                        value = uiState.noteDraft.newCategoryLabel,
                        categories = uiState.snapshot.categories,
                        busy = uiState.isBusy,
                        onValueChange = viewModel::updateNewCategoryLabel,
                        onCategorySelected = viewModel::selectDraftCategory,
                        onAddCategory = viewModel::createCategoryFromInput,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    TagComboField(
                        value = uiState.noteDraft.newTagLabel,
                        tags = uiState.snapshot.tags,
                        selectedTagIds = uiState.noteDraft.selectedTagIds,
                        busy = uiState.isBusy,
                        onValueChange = viewModel::updateNewTagLabel,
                        onTagSelected = viewModel::appendTagId,
                        onAddTag = viewModel::createTagFromInput,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (uiState.noteDraft.selectedTagIds.isNotEmpty()) {
                        FlowRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            uiState.noteDraft.selectedTagIds.forEach { id ->
                                val label =
                                    uiState.snapshot.tags.find { it.id == id }?.label
                                        ?: "Tag #$id"
                                TagPill(
                                    label = label,
                                    onRemove = { viewModel.removeTagId(id) },
                                )
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OptionalDateField(
                            label = "Due",
                            expanded = uiState.noteDraft.dueExpanded,
                            value = uiState.noteDraft.dueInput.orEmpty(),
                            onExpand = viewModel::expandDueInput,
                            onValueChange = viewModel::updateDueInput,
                            modifier =
                                Modifier.weight(
                                    if (uiState.noteDraft.dueExpanded) 1f else 0.45f,
                                    fill = uiState.noteDraft.dueExpanded,
                                ),
                        )
                        OptionalDateField(
                            label = "Remind",
                            expanded = uiState.noteDraft.remindExpanded,
                            value = uiState.noteDraft.remindInput.orEmpty(),
                            onExpand = viewModel::expandRemindInput,
                            onValueChange = viewModel::updateRemindInput,
                            modifier =
                                Modifier.weight(
                                    if (uiState.noteDraft.remindExpanded) 1f else 0.45f,
                                    fill = uiState.noteDraft.remindExpanded,
                                ),
                        )
                    }
                    Button(
                        onClick = viewModel::saveNote,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.isBusy,
                    ) {
                        Text(if (uiState.editingNoteId == null) "Create" else "Save")
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
}

@Composable
private fun OptionalDateField(
    label: String,
    expanded: Boolean,
    value: String,
    onExpand: () -> Unit,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!expanded) {
        TextButton(
            onClick = onExpand,
            modifier = modifier,
            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
        ) {
            Text(label)
            Spacer(Modifier.width(4.dp))
            Icon(
                Icons.Default.DateRange,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
        }
        return
    }

    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = modifier,
        singleLine = true,
    )
}

@Composable
private fun CategoryComboField(
    value: String,
    categories: List<CategoryRecord>,
    busy: Boolean,
    onValueChange: (String) -> Unit,
    onCategorySelected: (Int) -> Unit,
    onAddCategory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    var wasFocused by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val trimmedValue = value.trim()
    val matchingCategories = remember(categories, trimmedValue) {
        categories.matchingCategoryLabels(trimmedValue)
    }
    val hasExactMatch = remember(categories, trimmedValue) {
        categories.any { it.label.equals(trimmedValue, ignoreCase = true) }
    }
    val canShowDropdown = expanded && (trimmedValue.isNotEmpty() || categories.isNotEmpty())

    Box(modifier = modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                onValueChange(it)
                expanded = true
            },
            enabled = !busy,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .onFocusChanged { focusState ->
                        if (focusState.isFocused && !wasFocused) {
                            onValueChange("")
                            expanded = true
                        }
                        wasFocused = focusState.isFocused
                    },
            singleLine = true,
            label = { Text("Category") },
            placeholder = { Text("Type or select category") },
            trailingIcon = {
                IconButton(onClick = { expanded = true }) {
                    Icon(Icons.Default.ArrowDropDown, contentDescription = "Show categories")
                }
            },
        )
        DropdownMenu(
            expanded = canShowDropdown,
            onDismissRequest = { expanded = false },
            properties = PopupProperties(focusable = false),
        ) {
            if (trimmedValue.isNotEmpty() && !hasExactMatch) {
                DropdownMenuItem(
                    text = { Text("Add \"$trimmedValue\"") },
                    enabled = !busy,
                    onClick = {
                        expanded = false
                        focusManager.clearFocus()
                        onAddCategory()
                    },
                )
                if (matchingCategories.isNotEmpty()) {
                    HorizontalDivider()
                }
            }
            matchingCategories.forEach { category ->
                DropdownMenuItem(
                    text = { Text(category.label) },
                    onClick = {
                        expanded = false
                        focusManager.clearFocus()
                        onCategorySelected(category.id)
                    },
                )
            }
        }
    }
}

@Composable
private fun TagPill(
    label: String,
    onRemove: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(50),
    ) {
        Row(
            modifier = Modifier.padding(start = 10.dp, end = 2.dp, top = 2.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall,
            )
            IconButton(
                onClick = onRemove,
                modifier = Modifier.size(24.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Remove tag",
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}

@Composable
private fun TagComboField(
    value: String,
    tags: List<TagRecord>,
    selectedTagIds: List<Int>,
    busy: Boolean,
    onValueChange: (String) -> Unit,
    onTagSelected: (Int) -> Unit,
    onAddTag: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    var wasFocused by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val trimmedValue = value.trim()
    val availableTags = remember(tags, selectedTagIds) {
        val selectedIds = selectedTagIds.toSet()
        tags.filterNot { it.id in selectedIds }
    }
    val matchingTags = remember(availableTags, trimmedValue) {
        availableTags.matchingTagLabels(trimmedValue)
    }
    val hasExactMatch = remember(availableTags, trimmedValue) {
        availableTags.any { it.label.equals(trimmedValue, ignoreCase = true) }
    }
    val canShowDropdown = expanded && (trimmedValue.isNotEmpty() || matchingTags.isNotEmpty())
    val shouldFloatLabelForSelectedTags = value.isEmpty() && selectedTagIds.isNotEmpty()
    val displayValue = if (shouldFloatLabelForSelectedTags) " " else value

    Box(modifier = modifier) {
        OutlinedTextField(
            value = displayValue,
            onValueChange = { rawValue ->
                val nextValue =
                    if (shouldFloatLabelForSelectedTags && rawValue.startsWith(" ")) {
                        rawValue.drop(1)
                    } else {
                        rawValue
                    }
                onValueChange(nextValue)
                expanded = true
            },
            enabled = !busy,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .onFocusChanged { focusState ->
                        if (focusState.isFocused && !wasFocused) {
                            onValueChange("")
                            expanded = true
                        }
                        wasFocused = focusState.isFocused
                    },
            singleLine = true,
            label = { Text("Tags") },
            trailingIcon = {
                IconButton(onClick = { expanded = true }) {
                    Icon(Icons.Default.ArrowDropDown, contentDescription = "Show tags")
                }
            },
        )
        DropdownMenu(
            expanded = canShowDropdown,
            onDismissRequest = { expanded = false },
            properties = PopupProperties(focusable = false),
        ) {
            if (trimmedValue.isNotEmpty() && !hasExactMatch) {
                DropdownMenuItem(
                    text = { Text("Add \"$trimmedValue\"") },
                    enabled = !busy,
                    onClick = {
                        expanded = false
                        focusManager.clearFocus()
                        onAddTag()
                    },
                )
                if (matchingTags.isNotEmpty()) {
                    HorizontalDivider()
                }
            }
            matchingTags.forEach { tag ->
                DropdownMenuItem(
                    text = { Text(tag.label) },
                    onClick = {
                        expanded = false
                        focusManager.clearFocus()
                        onTagSelected(tag.id)
                    },
                )
            }
        }
    }
}

private fun <T> matchingLabels(
    items: List<T>,
    query: String,
    label: (T) -> String,
): List<T> {
    if (query.isBlank()) {
        return items
    }
    return items.filter { label(it).contains(query, ignoreCase = true) }
}

private fun List<CategoryRecord>.matchingCategoryLabels(query: String): List<CategoryRecord> =
    matchingLabels(this, query) { it.label }

private fun List<TagRecord>.matchingTagLabels(query: String): List<TagRecord> =
    matchingLabels(this, query) { it.label }

@Composable
private fun NotesTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(modifier = Modifier.fillMaxSize(), content = content)
    }
}
