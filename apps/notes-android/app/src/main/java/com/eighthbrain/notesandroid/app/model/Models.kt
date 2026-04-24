package com.eighthbrain.notesandroid.app.model

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

enum class WidgetMode {
    NOTES,
    SEARCH,
}

data class NotesAppPreferences(
    val resultsColumnWidth: Int?,
)

data class UserPreferences(
    val notesApp: NotesAppPreferences?,
)

data class UserSummary(
    val id: Int,
    val username: String,
    val email: String?,
    val phone: String?,
    val preferences: UserPreferences,
)

data class CategoryRecord(
    val id: Int,
    val userId: Int,
    val label: String,
    val noteCount: Int = 0,
    val lastUsedAt: String? = null,
)

data class TagRecord(
    val id: Int,
    val userId: Int,
    val label: String,
    val noteCount: Int = 0,
    val lastUsedAt: String? = null,
)

data class NoteCategoryRef(
    val id: Int,
    val label: String,
)

data class NoteTagRef(
    val id: Int,
    val label: String,
)

data class NoteRecord(
    val id: Int,
    val userId: Int,
    val category: NoteCategoryRef,
    val tags: List<NoteTagRef>,
    val description: String?,
    val timeDue: String,
    val timeRemind: String,
    val timeCreated: String,
    val timeModified: String,
)

fun List<NoteRecord>.sortedByLastUpdated(): List<NoteRecord> =
    sortedByDescending { Instant.parse(it.timeModified) }

data class SemanticSearchResult(
    val note: NoteRecord,
    val similarity: Double,
    val tagSimilarity: Double?,
    val descriptionSimilarity: Double?,
)

data class NoteDraft(
    val selectedCategoryId: Int? = null,
    val newCategoryLabel: String = "",
    val selectedTagIds: List<Int> = emptyList(),
    val newTagLabel: String = "",
    val description: String = "",
    val dueInput: String = defaultDueInput(),
    val remindInput: String = defaultRemindInput(),
)

data class AppSnapshot(
    val user: UserSummary? = null,
    val categories: List<CategoryRecord> = emptyList(),
    val tags: List<TagRecord> = emptyList(),
    val notes: List<NoteRecord> = emptyList(),
    val lastSearchQuery: String = "",
    val searchResults: List<SemanticSearchResult> = emptyList(),
    val widgetMode: WidgetMode = WidgetMode.NOTES,
    val lastSyncEpochMillis: Long? = null,
    val lastError: String? = null,
)

private val localInputFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")
private val dateTimeFormatter = DateTimeFormatter.ofLocalizedDateTime(
    FormatStyle.MEDIUM,
    FormatStyle.SHORT,
)

private fun nowLocalDateTime(): LocalDateTime = LocalDateTime.now(ZoneId.systemDefault())

fun defaultDueInput(): String = nowLocalDateTime().plusDays(1).format(localInputFormatter)

fun defaultRemindInput(): String = nowLocalDateTime().plusMinutes(30).format(localInputFormatter)

fun NoteRecord.toDraft(): NoteDraft =
    NoteDraft(
        selectedCategoryId = category.id,
        newCategoryLabel = "",
        selectedTagIds = tags.map { it.id },
        newTagLabel = "",
        description = description.orEmpty(),
        dueInput = isoToLocalInput(timeDue),
        remindInput = isoToLocalInput(timeRemind),
    )

fun NoteRecord.headline(): String {
    val raw = description?.trim() ?: ""
    if (raw.isEmpty()) return "Untitled"
    val firstLine = raw.split("\n", "\r\n").first()
    return if (firstLine.length <= 100) firstLine else firstLine.take(100) + "…"
}

fun NoteRecord.descriptionBody(): String {
    val raw = description ?: return ""
    if (raw.isBlank()) return ""
    val lines = raw.split("\n", "\r\n")
    if (lines.size <= 1) return ""
    return lines.drop(1).joinToString("\n").trimStart('\n', '\r')
}

fun isoToLocalInput(value: String): String =
    Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDateTime().format(localInputFormatter)

fun parseLocalInputToIso(
    value: String,
    fieldName: String,
): String {
    val trimmed = value.trim()
    require(trimmed.isNotEmpty()) { "$fieldName is required." }

    return try {
        LocalDateTime.parse(trimmed, localInputFormatter)
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toString()
    } catch (_: Exception) {
        throw IllegalArgumentException("$fieldName must use the format yyyy-MM-dd'T'HH:mm.")
    }
}

fun formatTimestamp(value: String): String =
    Instant.parse(value).atZone(ZoneId.systemDefault()).format(dateTimeFormatter)

private val conciseDateFull = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
private val conciseDateShort = DateTimeFormatter.ofPattern("MM-dd HH:mm")

/** Short local date-time for list and widget labels (matches main note rows). */
fun formatConciseDate(isoValue: String): String {
    val zoned = Instant.parse(isoValue).atZone(ZoneId.systemDefault())
    val now = ZonedDateTime.now()
    return zoned.format(if (zoned.year != now.year) conciseDateFull else conciseDateShort)
}

fun List<NoteRecord>.sortedByLastUpdatedDescending(): List<NoteRecord> =
    sortedByDescending { Instant.parse(it.timeModified) }

fun formatPercent(value: Double?): String {
    if (value == null) {
        return "n/a"
    }

    val bounded = (value * 100.0).toInt().coerceIn(0, 100)
    return "$bounded%"
}
