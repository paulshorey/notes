package com.eighthbrain.notesandroid.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.eighthbrain.notesandroid.app.model.TagRecord

/**
 * Shared tag-picker popup list UI used by both the widget overlay and the
 * main app screen. Each row shows the tag label, the note count, and edit
 * and delete icon buttons. A row switches to an inline text field for edit mode
 * and to a confirmation block for delete mode. The topmost row is an "All notes"
 * entry that clears the filter and shows the total note count.
 *
 * State is hoisted so each caller decides whether to drive it from a ViewModel
 * (main app) or from local `remember` state (widget overlay activity).
 */
@Composable
fun TagsPopupList(
    tags: List<TagRecord>,
    totalNoteCount: Int,
    selectedTagId: Int?,
    editingTagId: Int?,
    editingDraft: String,
    deletingTagId: Int?,
    busy: Boolean,
    onSelect: (Int?) -> Unit,
    onStartEdit: (TagRecord) -> Unit,
    onEditDraftChange: (String) -> Unit,
    onSaveEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onStartDelete: (TagRecord) -> Unit,
    onConfirmDelete: () -> Unit,
    onCancelDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable { onSelect(null) }
                    .padding(horizontal = 4.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "All notes",
                style = MaterialTheme.typography.bodyLarge,
                color =
                    if (selectedTagId == null) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                modifier = Modifier.weight(1f),
            )
            Text(
                text = totalNoteCount.toString(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
        ) {
            tags.forEach { tag ->
                when {
                    editingTagId == tag.id ->
                        TagEditRow(
                            draft = editingDraft,
                            busy = busy,
                            onDraftChange = onEditDraftChange,
                            onSave = onSaveEdit,
                            onCancel = onCancelEdit,
                        )
                    deletingTagId == tag.id ->
                        TagDeleteConfirmRow(
                            tag = tag,
                            busy = busy,
                            onConfirm = onConfirmDelete,
                            onCancel = onCancelDelete,
                        )
                    else ->
                        TagDefaultRow(
                            tag = tag,
                            isActive = selectedTagId == tag.id,
                            busy = busy,
                            onSelect = { onSelect(tag.id) },
                            onEdit = { onStartEdit(tag) },
                            onDelete = { onStartDelete(tag) },
                        )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.2f))
            }
            if (tags.isEmpty()) {
                Text(
                    "No tags yet.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun TagDefaultRow(
    tag: TagRecord,
    isActive: Boolean,
    busy: Boolean,
    onSelect: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = tag.label,
            style = MaterialTheme.typography.bodyLarge,
            color =
                if (isActive) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            overflow = TextOverflow.Ellipsis,
            maxLines = 1,
            modifier =
                Modifier
                    .weight(1f)
                    .clickable { onSelect() }
                    .padding(horizontal = 4.dp, vertical = 12.dp),
        )
        Text(
            text = tag.noteCount.toString(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        IconButton(
            onClick = onEdit,
            modifier = Modifier.size(36.dp),
            enabled = !busy,
        ) {
            Icon(
                Icons.Default.Edit,
                contentDescription = "Edit",
                modifier = Modifier.size(16.dp),
            )
        }
        IconButton(
            onClick = onDelete,
            modifier = Modifier.size(36.dp),
            enabled = !busy,
        ) {
            Icon(
                Icons.Default.Delete,
                contentDescription = "Delete",
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun TagEditRow(
    draft: String,
    busy: Boolean,
    onDraftChange: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            singleLine = true,
            label = { Text("Tag name") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onCancel, enabled = !busy) {
                Text("Cancel")
            }
            Spacer(modifier = Modifier.size(8.dp))
            TextButton(
                onClick = onSave,
                enabled = !busy && draft.trim().isNotEmpty(),
            ) {
                Text("Save")
            }
        }
    }
}

@Composable
private fun TagDeleteConfirmRow(
    tag: TagRecord,
    busy: Boolean,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Delete \"${tag.label}\"?",
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            text =
                "${tag.noteCount} " +
                    if (tag.noteCount == 1) "note uses it." else "notes use it.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onCancel, enabled = !busy) {
                Text("Cancel")
            }
            Spacer(modifier = Modifier.size(8.dp))
            TextButton(onClick = onConfirm, enabled = !busy) {
                Text(
                    "Confirm",
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
