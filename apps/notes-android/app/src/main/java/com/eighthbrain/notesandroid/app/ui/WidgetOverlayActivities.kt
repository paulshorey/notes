package com.eighthbrain.notesandroid.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import com.eighthbrain.notesandroid.app.NotesApplication
import com.eighthbrain.notesandroid.app.data.NotesRepository
import com.eighthbrain.notesandroid.app.model.CategoryRecord
import com.eighthbrain.notesandroid.app.model.TagRecord
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.toDraft
import com.eighthbrain.notesandroid.app.widget.NotesHomeWidget
import com.eighthbrain.notesandroid.app.widget.readCategoryFilterId
import com.eighthbrain.notesandroid.app.widget.readTagFilterId
import com.eighthbrain.notesandroid.app.widget.widgetCategoryFilterKey
import com.eighthbrain.notesandroid.app.widget.widgetTagFilterKey
import kotlinx.coroutines.launch

class WidgetLoginActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetLoginScreen(
                    repository = repository,
                    finishOverlay = { finish() },
                )
            }
        }
    }
}

class WidgetSearchActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetSearchScreen(
                    repository = repository,
                    finishOverlay = { finish() },
                )
            }
        }
    }
}

class WidgetCategoryPickerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetCategoryPickerScreen(
                    repository = repository,
                    finishOverlay = { finish() },
                )
            }
        }
    }
}

class WidgetTagPickerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetTagPickerScreen(
                    repository = repository,
                    finishOverlay = { finish() },
                )
            }
        }
    }
}

class WidgetNoteEditorActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val noteId = intent.getIntExtra(extraNoteId, -1).takeIf { it > 0 }

        setContent {
            OverlayTheme {
                val repository = (application as NotesApplication).repository
                WidgetNoteEditorScreen(
                    repository = repository,
                    noteId = noteId,
                    finishOverlay = { finish() },
                )
            }
        }
    }

    companion object {
        const val extraNoteId = "note_id"
    }
}

@Composable
private fun WidgetLoginScreen(
    repository: NotesRepository,
    finishOverlay: () -> Unit,
) {
    var identifier by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    OverlayCard(
        title = "Widget sign-in",
        subtitle = "Widgets cannot host text input, so this short overlay collects your username.",
        busy = busy,
        error = error,
    ) {
        OutlinedTextField(
            value = identifier,
            onValueChange = {
                identifier = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Username, email, or phone") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        repository.login(identifier)
                        finishOverlay()
                    } catch (exception: Exception) {
                        error = exception.message ?: "Unable to sign in."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Sign in")
        }
    }
}

@Composable
private fun WidgetSearchScreen(
    repository: NotesRepository,
    finishOverlay: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(repository) {
        val snapshot = repository.readSnapshot()
        query = snapshot.lastSearchQuery
    }

    OverlayCard(
        title = "Widget search",
        subtitle = "Enter a semantic query. Results will be written back to the home-screen widget.",
        busy = busy,
        error = error,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = {
                query = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Semantic query") },
            minLines = 3,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        repository.search(query)
                        finishOverlay()
                    } catch (exception: Exception) {
                        error = exception.message ?: "Unable to search."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Search and update widget")
        }
    }
}

@Composable
private fun WidgetCategoryPickerScreen(
    repository: NotesRepository,
    finishOverlay: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var categories by remember { mutableStateOf<List<CategoryRecord>>(emptyList()) }
    var totalNoteCount by remember { mutableStateOf(0) }
    var activeId by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var editingId by remember { mutableStateOf<Int?>(null) }
    var editingDraft by remember { mutableStateOf("") }
    var deletingId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun writeWidgetFilter(categoryId: Int?) {
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        val glanceIds = manager.getGlanceIds(NotesHomeWidget::class.java)
        val widget = NotesHomeWidget()
        glanceIds.forEach { glanceId ->
            updateAppWidgetState(appContext, glanceId) { prefs ->
                if (categoryId == null) {
                    prefs.remove(widgetCategoryFilterKey)
                } else {
                    prefs[widgetCategoryFilterKey] = categoryId
                }
            }
            widget.update(appContext, glanceId)
        }
    }

    LaunchedEffect(repository) {
        val snapshot = repository.readSnapshot()
        categories = snapshot.categories
        totalNoteCount = snapshot.notes.size
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        val glanceIds = manager.getGlanceIds(NotesHomeWidget::class.java)
        activeId =
            glanceIds.firstNotNullOfOrNull { glanceId ->
                val prefs =
                    getAppWidgetState(
                        appContext,
                        PreferencesGlanceStateDefinition,
                        glanceId,
                    )
                readCategoryFilterId(prefs)
            }
    }

    fun select(categoryId: Int?) {
        scope.launch {
            busy = true
            error = null
            try {
                writeWidgetFilter(categoryId)
                activeId = categoryId
                finishOverlay()
            } catch (exception: Exception) {
                error = exception.message ?: "Unable to apply filter."
            } finally {
                busy = false
            }
        }
    }

    fun startEdit(category: CategoryRecord) {
        editingId = category.id
        editingDraft = category.label
        deletingId = null
        error = null
    }

    fun cancelEdit() {
        editingId = null
        editingDraft = ""
    }

    fun saveEdit() {
        val id = editingId ?: return
        val trimmed = editingDraft.trim()
        if (trimmed.isEmpty()) return
        scope.launch {
            busy = true
            error = null
            try {
                val snapshot = repository.updateCategory(id, trimmed)
                categories = snapshot.categories
                totalNoteCount = snapshot.notes.size
                editingId = null
                editingDraft = ""
            } catch (exception: Exception) {
                error = exception.message ?: "Unable to save category."
            } finally {
                busy = false
            }
        }
    }

    fun startDelete(category: CategoryRecord) {
        editingId = null
        editingDraft = ""
        error = null
        if (categories.size <= 1) {
            error = "Create another category before deleting the last one."
            return
        }
        if (category.noteCount == 0) {
            deletingId = null
            scope.launch {
                busy = true
                error = null
                try {
                    val snapshot = repository.deleteCategory(category.id)
                    categories = snapshot.categories
                    totalNoteCount = snapshot.notes.size
                    if (activeId == category.id) {
                        writeWidgetFilter(null)
                        activeId = null
                    }
                } catch (exception: Exception) {
                    error = exception.message ?: "Unable to delete category."
                } finally {
                    busy = false
                }
            }
        } else {
            deletingId = category.id
        }
    }

    fun cancelDelete() {
        deletingId = null
    }

    fun confirmDelete() {
        val id = deletingId ?: return
        scope.launch {
            busy = true
            error = null
            try {
                val snapshot = repository.deleteCategory(id)
                categories = snapshot.categories
                totalNoteCount = snapshot.notes.size
                deletingId = null
                if (activeId == id) {
                    writeWidgetFilter(null)
                    activeId = null
                }
            } catch (exception: Exception) {
                error = exception.message ?: "Unable to delete category."
            } finally {
                busy = false
            }
        }
    }

    OverlayCard(
        busy = busy,
        error = error,
        topTrailing = {
            TextButton(onClick = finishOverlay) {
                Text("X")
            }
        },
    ) {
        CategoriesPopupList(
            categories = categories,
            totalNoteCount = totalNoteCount,
            selectedCategoryId = activeId,
            editingCategoryId = editingId,
            editingDraft = editingDraft,
            deletingCategoryId = deletingId,
            protectedCategoryId = categories.minByOrNull { it.id }?.id,
            busy = busy,
            onSelect = { id -> select(id) },
            onStartEdit = { category -> startEdit(category) },
            onEditDraftChange = { editingDraft = it },
            onSaveEdit = { saveEdit() },
            onCancelEdit = { cancelEdit() },
            onStartDelete = { category -> startDelete(category) },
            onConfirmDelete = { confirmDelete() },
            onCancelDelete = { cancelDelete() },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun WidgetTagPickerScreen(
    repository: NotesRepository,
    finishOverlay: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var tags by remember { mutableStateOf<List<TagRecord>>(emptyList()) }
    var totalNoteCount by remember { mutableStateOf(0) }
    var activeId by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var editingId by remember { mutableStateOf<Int?>(null) }
    var editingDraft by remember { mutableStateOf("") }
    var deletingId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun writeWidgetFilter(tagId: Int?) {
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        val glanceIds = manager.getGlanceIds(NotesHomeWidget::class.java)
        val widget = NotesHomeWidget()
        glanceIds.forEach { glanceId ->
            updateAppWidgetState(appContext, glanceId) { prefs ->
                if (tagId == null) {
                    prefs.remove(widgetTagFilterKey)
                } else {
                    prefs[widgetTagFilterKey] = tagId
                }
            }
            widget.update(appContext, glanceId)
        }
    }

    LaunchedEffect(repository) {
        val snapshot = repository.readSnapshot()
        tags = snapshot.tags
        totalNoteCount = snapshot.notes.size
        val appContext = context.applicationContext
        val manager = GlanceAppWidgetManager(appContext)
        val glanceIds = manager.getGlanceIds(NotesHomeWidget::class.java)
        activeId =
            glanceIds.firstNotNullOfOrNull { glanceId ->
                val prefs =
                    getAppWidgetState(
                        appContext,
                        PreferencesGlanceStateDefinition,
                        glanceId,
                    )
                readTagFilterId(prefs)
            }
    }

    fun select(tagId: Int?) {
        scope.launch {
            busy = true
            error = null
            try {
                writeWidgetFilter(tagId)
                activeId = tagId
                finishOverlay()
            } catch (exception: Exception) {
                error = exception.message ?: "Unable to apply filter."
            } finally {
                busy = false
            }
        }
    }

    fun startEdit(tag: TagRecord) {
        editingId = tag.id
        editingDraft = tag.label
        deletingId = null
        error = null
    }

    fun cancelEdit() {
        editingId = null
        editingDraft = ""
    }

    fun saveEdit() {
        val id = editingId ?: return
        val trimmed = editingDraft.trim()
        if (trimmed.isEmpty()) return
        scope.launch {
            busy = true
            error = null
            try {
                val snapshot = repository.updateTag(id, trimmed)
                tags = snapshot.tags
                totalNoteCount = snapshot.notes.size
                editingId = null
                editingDraft = ""
            } catch (exception: Exception) {
                error = exception.message ?: "Unable to save tag."
            } finally {
                busy = false
            }
        }
    }

    fun startDelete(tag: TagRecord) {
        editingId = null
        editingDraft = ""
        error = null
        if (tag.noteCount == 0) {
            deletingId = null
            scope.launch {
                busy = true
                error = null
                try {
                    val snapshot = repository.deleteTag(tag.id)
                    tags = snapshot.tags
                    totalNoteCount = snapshot.notes.size
                    if (activeId == tag.id) {
                        writeWidgetFilter(null)
                        activeId = null
                    }
                } catch (exception: Exception) {
                    error = exception.message ?: "Unable to delete tag."
                } finally {
                    busy = false
                }
            }
        } else {
            deletingId = tag.id
        }
    }

    fun cancelDelete() {
        deletingId = null
    }

    fun confirmDelete() {
        val id = deletingId ?: return
        scope.launch {
            busy = true
            error = null
            try {
                val snapshot = repository.deleteTag(id)
                tags = snapshot.tags
                totalNoteCount = snapshot.notes.size
                deletingId = null
                if (activeId == id) {
                    writeWidgetFilter(null)
                    activeId = null
                }
            } catch (exception: Exception) {
                error = exception.message ?: "Unable to delete tag."
            } finally {
                busy = false
            }
        }
    }

    OverlayCard(
        busy = busy,
        error = error,
        topTrailing = {
            TextButton(onClick = finishOverlay) {
                Text("X")
            }
        },
    ) {
        TagsPopupList(
            tags = tags,
            totalNoteCount = totalNoteCount,
            selectedTagId = activeId,
            editingTagId = editingId,
            editingDraft = editingDraft,
            deletingTagId = deletingId,
            busy = busy,
            onSelect = { id -> select(id) },
            onStartEdit = { tag -> startEdit(tag) },
            onEditDraftChange = { editingDraft = it },
            onSaveEdit = { saveEdit() },
            onCancelEdit = { cancelEdit() },
            onStartDelete = { tag -> startDelete(tag) },
            onConfirmDelete = { confirmDelete() },
            onCancelDelete = { cancelDelete() },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun WidgetNoteEditorScreen(
    repository: NotesRepository,
    noteId: Int?,
    finishOverlay: () -> Unit,
) {
    var categories by remember { mutableStateOf<List<CategoryRecord>>(emptyList()) }
    var tags by remember { mutableStateOf<List<TagRecord>>(emptyList()) }
    var selectedCategoryId by remember { mutableStateOf<Int?>(null) }
    var selectedTagIds by remember { mutableStateOf<List<Int>>(emptyList()) }
    var newCategoryLabel by remember { mutableStateOf("") }
    var newTagLabel by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var dueInput by remember { mutableStateOf(NoteDraft().dueInput) }
    var remindInput by remember { mutableStateOf(NoteDraft().remindInput) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(repository, noteId) {
        categories = repository.categories()
        tags = repository.tags()
        val note = noteId?.let { repository.noteById(it) }
        if (note != null) {
            val draft = note.toDraft()
            selectedCategoryId = draft.selectedCategoryId
            selectedTagIds = draft.selectedTagIds
            description = draft.description
            dueInput = draft.dueInput
            remindInput = draft.remindInput
        } else {
            selectedCategoryId = categories.firstOrNull()?.id
            selectedTagIds = emptyList()
        }
    }

    OverlayCard(
        title = if (noteId == null) "New note" else "Edit note",
        subtitle = "Use yyyy-MM-ddTHH:mm values for the due and reminder fields.",
        busy = busy,
        error = error,
    ) {
        Text(
            text = "Category (required)",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = newCategoryLabel,
                onValueChange = {
                    newCategoryLabel = it
                    error = null
                },
                modifier = Modifier.weight(1f),
                label = { Text("New category label") },
                singleLine = true,
            )
            Button(
                onClick = {
                    scope.launch {
                        val label = newCategoryLabel.trim()
                        if (label.isEmpty()) {
                            return@launch
                        }
                        busy = true
                        error = null
                        try {
                            val category = repository.createCategory(label)
                            categories = repository.categories()
                            selectedCategoryId = category.id
                            newCategoryLabel = ""
                        } catch (exception: Exception) {
                            error = exception.message ?: "Unable to add category."
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && newCategoryLabel.trim().isNotEmpty(),
            ) {
                Text("Add")
            }
        }
        WidgetCategoryDropdown(
            categories = categories,
            selectedCategoryId = selectedCategoryId,
            onCategorySelected = {
                selectedCategoryId = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = "New tag (saved immediately)",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = newTagLabel,
                onValueChange = {
                    newTagLabel = it
                    error = null
                },
                modifier = Modifier.weight(1f),
                label = { Text("New tag label") },
                singleLine = true,
            )
            Button(
                onClick = {
                    scope.launch {
                        val label = newTagLabel.trim()
                        if (label.isEmpty()) {
                            return@launch
                        }
                        busy = true
                        error = null
                        try {
                            val tag = repository.createTag(label)
                            tags = repository.tags()
                            if (!selectedTagIds.contains(tag.id)) {
                                selectedTagIds = selectedTagIds + tag.id
                            }
                            newTagLabel = ""
                        } catch (exception: Exception) {
                            error = exception.message ?: "Unable to add tag."
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && newTagLabel.trim().isNotEmpty(),
            ) {
                Text("Add")
            }
        }
        Text(
            text = "Append from existing",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        WidgetTagAppendDropdown(
            tags = tags,
            onTagSelected = { id ->
                if (!selectedTagIds.contains(id)) {
                    selectedTagIds = selectedTagIds + id
                }
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
        )
        if (selectedTagIds.isNotEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                selectedTagIds.forEach { id ->
                    val label = tags.find { it.id == id }?.label ?: "Tag #$id"
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(label)
                        IconButton(
                            onClick = {
                                selectedTagIds = selectedTagIds.filter { it != id }
                            },
                            modifier = Modifier.size(32.dp),
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Remove")
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = description,
            onValueChange = {
                description = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Description") },
            minLines = 4,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = dueInput.orEmpty(),
            onValueChange = {
                dueInput = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Due time") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = remindInput.orEmpty(),
            onValueChange = {
                remindInput = it
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Reminder time") },
            singleLine = true,
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        val categoryId =
                            selectedCategoryId
                                ?: throw IllegalStateException("Choose a category before saving.")
                        repository.saveNote(
                            noteId = noteId,
                            noteDraft =
                                NoteDraft(
                                    selectedCategoryId = categoryId,
                                    selectedTagIds = selectedTagIds,
                                    newCategoryLabel = "",
                                    newTagLabel = "",
                                    description = description,
                                    dueInput = dueInput,
                                    remindInput = remindInput,
                                ),
                        )
                        finishOverlay()
                    } catch (exception: Exception) {
                        error = exception.message ?: "Unable to save note."
                    } finally {
                        busy = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (noteId == null) "Create note" else "Save note")
        }
        if (noteId != null) {
            Spacer(modifier = Modifier.height(8.dp))
            TextButton(
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        try {
                            repository.deleteNote(noteId)
                            finishOverlay()
                        } catch (exception: Exception) {
                            error = exception.message ?: "Unable to delete note."
                        } finally {
                            busy = false
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Delete note")
            }
        }
    }
}

@Composable
private fun WidgetCategoryDropdown(
    categories: List<CategoryRecord>,
    selectedCategoryId: Int?,
    onCategorySelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel =
        categories.firstOrNull { it.id == selectedCategoryId }?.label ?: "Pick category"

    Box(modifier = modifier) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Category") },
            singleLine = true,
            readOnly = true,
            enabled = categories.isNotEmpty(),
        )
        if (categories.isNotEmpty()) {
            Box(
                modifier =
                    Modifier
                        .matchParentSize()
                        .clickable { expanded = true },
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            categories.forEach { category ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = category.label,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    onClick = {
                        onCategorySelected(category.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun WidgetTagAppendDropdown(
    tags: List<TagRecord>,
    onTagSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val placeholder =
        if (tags.isEmpty()) {
            "No tags yet"
        } else {
            "Pick to append"
        }

    Box(modifier = modifier) {
        OutlinedTextField(
            value = placeholder,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Existing tags") },
            singleLine = true,
            readOnly = true,
            enabled = tags.isNotEmpty(),
        )
        if (tags.isNotEmpty()) {
            Box(
                modifier =
                    Modifier
                        .matchParentSize()
                        .clickable { expanded = true },
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            tags.forEach { tag ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = tag.label,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    onClick = {
                        onTagSelected(tag.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun OverlayCard(
    title: String? = null,
    subtitle: String? = null,
    busy: Boolean,
    error: String?,
    topTrailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (topTrailing != null || !title.isNullOrBlank() || !subtitle.isNullOrBlank()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        if (!title.isNullOrBlank()) {
                            Text(text = title, style = MaterialTheme.typography.titleLarge)
                        }
                        if (!subtitle.isNullOrBlank()) {
                            Text(text = subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    topTrailing?.invoke()
                }
            }
            if (busy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            if (!error.isNullOrBlank()) {
                Text(text = error, color = MaterialTheme.colorScheme.error)
            }
            content()
        }
    }
}

@Composable
private fun OverlayTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
