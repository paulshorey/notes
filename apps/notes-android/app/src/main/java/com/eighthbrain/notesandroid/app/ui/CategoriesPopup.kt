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
import com.eighthbrain.notesandroid.app.model.CategoryRecord

@Composable
fun CategoriesPopupList(
    categories: List<CategoryRecord>,
    totalNoteCount: Int,
    selectedCategoryId: Int?,
    editingCategoryId: Int?,
    editingDraft: String,
    deletingCategoryId: Int?,
    protectedCategoryId: Int?,
    busy: Boolean,
    onSelect: (Int?) -> Unit,
    onStartEdit: (CategoryRecord) -> Unit,
    onEditDraftChange: (String) -> Unit,
    onSaveEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onStartDelete: (CategoryRecord) -> Unit,
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
                    if (selectedCategoryId == null) {
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
            categories.forEach { category ->
                when {
                    editingCategoryId == category.id ->
                        CategoryEditRow(
                            draft = editingDraft,
                            busy = busy,
                            onDraftChange = onEditDraftChange,
                            onSave = onSaveEdit,
                            onCancel = onCancelEdit,
                        )
                    deletingCategoryId == category.id ->
                        CategoryDeleteConfirmRow(
                            category = category,
                            busy = busy,
                            onConfirm = onConfirmDelete,
                            onCancel = onCancelDelete,
                        )
                    else ->
                        CategoryDefaultRow(
                            category = category,
                            isActive = selectedCategoryId == category.id,
                            isProtected = category.id == protectedCategoryId,
                            busy = busy,
                            onSelect = { onSelect(category.id) },
                            onEdit = { onStartEdit(category) },
                            onDelete = { onStartDelete(category) },
                        )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.2f))
            }
            if (categories.isEmpty()) {
                Text(
                    "No categories yet.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun CategoryDefaultRow(
    category: CategoryRecord,
    isActive: Boolean,
    isProtected: Boolean,
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
            text = category.label,
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
            text = category.noteCount.toString(),
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
        if (!isProtected) {
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
}

@Composable
private fun CategoryEditRow(
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
            label = { Text("Category name") },
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
private fun CategoryDeleteConfirmRow(
    category: CategoryRecord,
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
            text = "Delete \"${category.label}\"?",
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            text =
                "${category.noteCount} " +
                    if (category.noteCount == 1) "note uses it." else "notes use it.",
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
