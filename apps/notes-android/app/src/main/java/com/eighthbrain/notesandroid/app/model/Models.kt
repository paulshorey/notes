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

/** Result of POST /api/auth/token: the bearer token plus the signed-in user. */
data class LoginSession(
    val token: String,
    val user: UserSummary,
)

/**
 * One node of the Epic > Category > Group tree. `level` (1 epic, 2 category,
 * 3 group) is the only stable identity a tier has — never branch on the label,
 * which the user can rename.
 */
data class TaxonomyRecord(
    val id: Int,
    val userId: Int,
    val level: Int,
    val parentId: Int?,
    val label: String,
    val noteCount: Int = 0,
    val directNoteCount: Int = 0,
    val lastUsedAt: String? = null,
)

/** This user's word for one tier. Display text only. */
data class TaxonomyLevelRecord(
    val userId: Int,
    val level: Int,
    val label: String,
)

data class TagRecord(
    val id: Int,
    val userId: Int,
    val label: String,
    val noteCount: Int = 0,
    val lastUsedAt: String? = null,
)

data class NoteTagRef(
    val id: Int,
    val label: String,
)

data class NoteRecord(
    val id: Int,
    val userId: Int,
    /**
     * The leaf group only. Resolve the category and epic from the taxonomy tree
     * in [AppSnapshot]; the server no longer sends labels, so a rename needs no
     * note refetch and labels have one source of truth.
     */
    val groupId: Int,
    val tags: List<NoteTagRef>,
    val description: String?,
    val timeDue: String?,
    val timeRemind: String?,
    val timeCreated: String,
    val timeModified: String,
)

fun List<NoteRecord>.sortedByLastUpdated(): List<NoteRecord> =
    sortedByDescending { Instant.parse(it.timeModified) }

data class SemanticSearchResult(
    val note: NoteRecord,
    val similarity: Double,
)

data class NoteDraft(
    val selectedGroupId: Int? = null,
    val newGroupLabel: String = "",
    val selectedTagIds: List<Int> = emptyList(),
    val newTagLabel: String = "",
    val description: String = "",
    val dueInput: String? = null,
    val remindInput: String? = null,
    val dueExpanded: Boolean = false,
    val remindExpanded: Boolean = false,
)

data class AppSnapshot(
    val user: UserSummary? = null,
    val apiToken: String? = null,
    /**
     * The whole tree and this user's tier vocabulary. Both are required, not
     * optional: NoteRecord carries only a group id, so a widget without the
     * tree cannot render a note's location at all.
     */
    val taxonomy: List<TaxonomyRecord> = emptyList(),
    val taxonomyLevels: List<TaxonomyLevelRecord> = emptyList(),
    val tags: List<TagRecord> = emptyList(),
    val notes: List<NoteRecord> = emptyList(),
    val lastSearchQuery: String = "",
    val searchResults: List<SemanticSearchResult> = emptyList(),
    val widgetMode: WidgetMode = WidgetMode.NOTES,
    val lastSyncEpochMillis: Long? = null,
    val lastError: String? = null,
) {
    /** Only level-3 rows can hold a note. */
    val groups: List<TaxonomyRecord>
        get() = taxonomy.filter { it.level == 3 }

    /** This user's word for a tier, falling back to the shipped default. */
    fun levelLabel(level: Int): String =
        taxonomyLevels.firstOrNull { it.level == level }?.label
            ?: when (level) {
                1 -> "Epic"
                2 -> "Category"
                3 -> "Group"
                else -> "Note"
            }
}

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
        selectedGroupId = groupId,
        newGroupLabel = "",
        selectedTagIds = tags.map { it.id },
        newTagLabel = "",
        description = description.orEmpty(),
        dueInput = timeDue?.let(::isoToLocalInput),
        remindInput = timeRemind?.let(::isoToLocalInput),
        dueExpanded = timeDue != null,
        remindExpanded = timeRemind != null,
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
    value: String?,
    fieldName: String,
): String {
    val trimmed = value?.trim().orEmpty()
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

fun parseOptionalLocalInputToIso(
    value: String?,
    fieldName: String,
): String? = value?.let { parseLocalInputToIso(it, fieldName) }

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

fun formatOptionalConciseDate(isoValue: String?): String? = isoValue?.let(::formatConciseDate)

fun List<NoteRecord>.sortedByLastUpdatedDescending(): List<NoteRecord> =
    sortedByDescending { Instant.parse(it.timeModified) }

fun formatPercent(value: Double?): String {
    if (value == null) {
        return "n/a"
    }

    val bounded = (value * 100.0).toInt().coerceIn(0, 100)
    return "$bounded%"
}
