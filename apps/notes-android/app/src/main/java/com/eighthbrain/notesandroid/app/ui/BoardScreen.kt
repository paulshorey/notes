package com.eighthbrain.notesandroid.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.WorkflowStatusRecord
import com.eighthbrain.notesandroid.app.model.formatConciseDate
import com.eighthbrain.notesandroid.app.model.formatOptionalConciseDate
import com.eighthbrain.notesandroid.app.model.headline
import com.eighthbrain.notesandroid.app.model.sortedByLastUpdatedDescending

data class BoardStatusGroup(
    val status: WorkflowStatusRecord,
    val notes: List<NoteRecord>,
)

@Composable
fun BoardScreen(
    workflowStatuses: List<WorkflowStatusRecord>,
    notes: List<NoteRecord>,
    busy: Boolean,
    onEditNote: (NoteRecord) -> Unit,
    onMoveNoteToStatus: (NoteRecord, Int) -> Unit,
    onRemoveNoteFromBoard: (NoteRecord) -> Unit,
    onEditWorkflowStatus: (WorkflowStatusRecord) -> Unit,
    modifier: Modifier = Modifier,
) {
    val groups =
        remember(workflowStatuses, notes) {
            workflowStatuses
                .sortedBy { it.sortOrder }
                .map { status ->
                    BoardStatusGroup(
                        status = status,
                        notes =
                            notes
                                .filter { it.workflowStatus?.id == status.id }
                                .sortedByLastUpdatedDescending(),
                    )
                }
        }

    if (workflowStatuses.isEmpty()) {
        Text(
            text = if (busy) "Loading board…" else "No board columns yet.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
        )
        return
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 80.dp),
    ) {
        groups.forEach { group ->
            item(key = "header-${group.status.id}") {
                BoardColumnHeader(
                    status = group.status,
                    noteCount = group.notes.size,
                    busy = busy,
                    onEdit = { onEditWorkflowStatus(group.status) },
                )
            }
            if (group.notes.isEmpty()) {
                item(key = "empty-${group.status.id}") {
                    Text(
                        text = "Empty",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            } else {
                items(group.notes, key = { it.id }) { note ->
                    BoardNoteRow(
                        note = note,
                        workflowStatuses = workflowStatuses,
                        busy = busy,
                        onEdit = { onEditNote(note) },
                        onMoveToStatus = onMoveNoteToStatus,
                        onRemoveFromBoard = onRemoveNoteFromBoard,
                    )
                    HorizontalDivider(
                        modifier = Modifier.padding(horizontal = 12.dp),
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                    )
                }
            }
        }
    }
}

@Composable
private fun BoardColumnHeader(
    status: WorkflowStatusRecord,
    noteCount: Int,
    busy: Boolean,
    onEdit: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = status.label,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = noteCount.toString(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        IconButton(onClick = onEdit, enabled = !busy, modifier = Modifier.size(32.dp)) {
            Icon(
                Icons.Default.Edit,
                contentDescription = "Edit ${status.label}",
                modifier = Modifier.size(16.dp),
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
}

@Composable
private fun BoardNoteRow(
    note: NoteRecord,
    workflowStatuses: List<WorkflowStatusRecord>,
    busy: Boolean,
    onEdit: () -> Unit,
    onMoveToStatus: (NoteRecord, Int) -> Unit,
    onRemoveFromBoard: (NoteRecord) -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val moveTargets = workflowStatuses.filter { it.id != note.workflowStatus?.id }

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onEdit)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = note.headline(),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            FlowRow(
                modifier = Modifier.padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = note.category.label,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                note.timeDue?.let {
                    Text(
                        text = "due ${formatConciseDate(it)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                note.timeRemind?.let {
                    Text(
                        text = "remind ${formatConciseDate(it)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                formatOptionalConciseDate(note.timeCompleted)?.let {
                    Text(
                        text = "done $it",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        Box {
            IconButton(
                onClick = { menuOpen = true },
                enabled = !busy,
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    Icons.Default.MoreVert,
                    contentDescription = "Board actions",
                    modifier = Modifier.size(18.dp),
                )
            }
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
            ) {
                moveTargets.forEach { status ->
                    DropdownMenuItem(
                        text = { Text("Move to ${status.label}") },
                        onClick = {
                            menuOpen = false
                            onMoveToStatus(note, status.id)
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text("Remove from board") },
                    onClick = {
                        menuOpen = false
                        onRemoveFromBoard(note)
                    },
                )
            }
        }
    }
}

@Composable
fun AppViewTabs(
    appView: com.eighthbrain.notesandroid.app.model.AppView,
    onAppViewChange: (com.eighthbrain.notesandroid.app.model.AppView) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AppViewTab(
            label = "Notes",
            selected = appView == com.eighthbrain.notesandroid.app.model.AppView.LIBRARY,
            onClick = { onAppViewChange(com.eighthbrain.notesandroid.app.model.AppView.LIBRARY) },
        )
        AppViewTab(
            label = "Board",
            selected = appView == com.eighthbrain.notesandroid.app.model.AppView.BOARD,
            onClick = { onAppViewChange(com.eighthbrain.notesandroid.app.model.AppView.BOARD) },
        )
    }
}

@Composable
private fun AppViewTab(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelLarge,
        color =
            if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        modifier =
            Modifier
                .clickable(onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}
