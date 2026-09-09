package com.eighthbrain.notesandroid.app.data

import com.eighthbrain.notesandroid.app.model.CategoryRecord
import com.eighthbrain.notesandroid.app.model.NoteCategoryRef
import com.eighthbrain.notesandroid.app.model.NotesAppPreferences
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.NoteTagRef
import com.eighthbrain.notesandroid.app.model.SemanticSearchResult
import com.eighthbrain.notesandroid.app.model.TagRecord
import com.eighthbrain.notesandroid.app.model.StatusRecord
import com.eighthbrain.notesandroid.app.model.WorkspaceRecord
import com.eighthbrain.notesandroid.app.model.UserPreferences
import com.eighthbrain.notesandroid.app.model.UserSummary
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private fun JSONObject.stringOrNull(key: String): String? =
    if (isNull(key)) {
        null
    } else {
        optString(key, "").ifBlank { null }
    }

private fun JSONObject.doubleOrNull(key: String): Double? =
    if (isNull(key)) {
        null
    } else {
        optDouble(key)
    }

private fun JSONObject.intOrNull(key: String): Int? =
    if (isNull(key)) {
        null
    } else {
        getInt(key)
    }

fun applyUserSummaryDefaults(json: JSONObject): JSONObject =
    json.apply {
        if (opt("preferences") !is JSONObject) {
            put("preferences", JSONObject())
        }
    }

fun notesAppPreferencesToJson(preferences: NotesAppPreferences): JSONObject =
    JSONObject()
        .put("resultsColumnWidth", preferences.resultsColumnWidth)

fun notesAppPreferencesFromJson(json: JSONObject): NotesAppPreferences =
    NotesAppPreferences(
        resultsColumnWidth = json.intOrNull("resultsColumnWidth"),
    )

fun userPreferencesToJson(preferences: UserPreferences): JSONObject =
    JSONObject()
        .put(
            "notesApp",
            preferences.notesApp?.let(::notesAppPreferencesToJson),
        )

fun userPreferencesFromJson(json: JSONObject): UserPreferences =
    UserPreferences(
        notesApp =
            if (json.isNull("notesApp")) {
                null
            } else {
                notesAppPreferencesFromJson(json.getJSONObject("notesApp"))
            },
    )

fun userToJson(user: UserSummary): JSONObject =
    JSONObject()
        .put("id", user.id)
        .put("username", user.username)
        .put("email", user.email)
        .put("phone", user.phone)
        .put("preferences", userPreferencesToJson(user.preferences))

fun userFromJson(json: JSONObject): UserSummary =
    UserSummary(
        id = json.getInt("id"),
        username = json.getString("username"),
        email = json.stringOrNull("email"),
        phone = json.stringOrNull("phone"),
        preferences = userPreferencesFromJson(json.getJSONObject("preferences")),
    )

fun categoryToJson(category: CategoryRecord): JSONObject =
    JSONObject()
        .put("id", category.id)
        .put("workspaceId", category.workspaceId)
        .put("label", category.label)
        .put("noteCount", category.noteCount)
        .put("lastUsedAt", category.lastUsedAt)

fun categoryFromJson(json: JSONObject): CategoryRecord =
    CategoryRecord(
        id = json.getInt("id"),
        workspaceId = json.getInt("workspaceId"),
        label = json.getString("label"),
        noteCount = json.optInt("noteCount", 0),
        lastUsedAt = json.stringOrNull("lastUsedAt"),
    )

fun tagToJson(tag: TagRecord): JSONObject =
    JSONObject()
        .put("id", tag.id)
        .put("workspaceId", tag.workspaceId)
        .put("label", tag.label)
        .put("noteCount", tag.noteCount)
        .put("lastUsedAt", tag.lastUsedAt)

fun tagFromJson(json: JSONObject): TagRecord =
    TagRecord(
        id = json.getInt("id"),
        workspaceId = json.getInt("workspaceId"),
        label = json.getString("label"),
        noteCount = json.optInt("noteCount", 0),
        lastUsedAt = json.stringOrNull("lastUsedAt"),
    )

fun workspaceToJson(workspace: WorkspaceRecord): JSONObject =
    JSONObject()
        .put("id", workspace.id)
        .put("userId", workspace.userId)
        .put("label", workspace.label)
        .put("noteCount", workspace.noteCount)

fun workspaceFromJson(json: JSONObject): WorkspaceRecord =
    WorkspaceRecord(
        id = json.getInt("id"),
        userId = json.getInt("userId"),
        label = json.getString("label"),
        noteCount = json.optInt("noteCount", 0),
    )

fun statusToJson(status: StatusRecord): JSONObject =
    JSONObject()
        .put("id", status.id)
        .put("workspaceId", status.workspaceId)
        .put("label", status.label)
        .put("position", status.position)
        .put("noteCount", status.noteCount)
        .put("lastUsedAt", status.lastUsedAt)

fun statusFromJson(json: JSONObject): StatusRecord =
    StatusRecord(
        id = json.getInt("id"),
        workspaceId = json.getInt("workspaceId"),
        label = json.getString("label"),
        position = json.getInt("position"),
        noteCount = json.optInt("noteCount", 0),
        lastUsedAt = json.stringOrNull("lastUsedAt"),
    )

private fun noteTagRefFromJson(json: JSONObject): NoteTagRef =
    NoteTagRef(
        id = json.getInt("id"),
        label = json.getString("label"),
    )

private fun noteCategoryRefToJson(category: NoteCategoryRef): JSONObject =
    JSONObject()
        .put("id", category.id)
        .put("label", category.label)

private fun noteCategoryRefFromJson(json: JSONObject): NoteCategoryRef =
    NoteCategoryRef(
        id = json.getInt("id"),
        label = json.getString("label"),
    )

private fun tagsArrayFromJson(json: JSONObject): List<NoteTagRef> {
    if (!json.has("tags") || json.isNull("tags")) return emptyList()
    val array = json.getJSONArray("tags")
    return buildList {
        for (index in 0 until array.length()) {
            add(noteTagRefFromJson(array.getJSONObject(index)))
        }
    }
}

private fun categoriesArrayFromJson(json: JSONObject): List<NoteCategoryRef> {
    if (!json.has("categories") || json.isNull("categories")) return emptyList()
    val array = json.getJSONArray("categories")
    return buildList {
        for (index in 0 until array.length()) {
            add(noteCategoryRefFromJson(array.getJSONObject(index)))
        }
    }
}

private fun statusFromNoteJson(json: JSONObject): NoteCategoryRef? =
    if (json.isNull("status")) null else noteCategoryRefFromJson(json.getJSONObject("status"))

private fun <T> safeDecodeList(
    raw: String?,
    fallback: List<T> = emptyList(),
    decode: (JSONArray) -> List<T>,
): List<T> {
    if (raw.isNullOrBlank()) {
        return emptyList()
    }
    return try {
        decode(JSONArray(raw))
    } catch (_: JSONException) {
        fallback
    }
}

fun noteToJson(note: NoteRecord): JSONObject {
    val categoriesJson = JSONArray()
    note.categories.forEach { categoriesJson.put(noteCategoryRefToJson(it)) }
    val tagsJson = JSONArray()
    note.tags.forEach { ref ->
        tagsJson.put(
            JSONObject()
                .put("id", ref.id)
                .put("label", ref.label),
        )
    }
    return JSONObject()
        .put("id", note.id)
        .put("workspaceId", note.workspaceId)
        .put("categories", categoriesJson)
        .put("status", note.status?.let(::noteCategoryRefToJson))
        .put("tags", tagsJson)
        .put("description", note.description)
        .put("timeDue", note.timeDue)
        .put("timeRemind", note.timeRemind)
        .put("timeCreated", note.timeCreated)
        .put("timeModified", note.timeModified)
}

fun noteFromJson(json: JSONObject): NoteRecord =
    NoteRecord(
        id = json.getInt("id"),
        workspaceId = json.getInt("workspaceId"),
        categories = categoriesArrayFromJson(json),
        status = statusFromNoteJson(json),
        tags = tagsArrayFromJson(json),
        description = json.stringOrNull("description"),
        timeDue = json.stringOrNull("timeDue"),
        timeRemind = json.stringOrNull("timeRemind"),
        timeCreated = json.getString("timeCreated"),
        timeModified = json.getString("timeModified"),
    )

fun searchResultToJson(result: SemanticSearchResult): JSONObject =
    JSONObject()
        .put("note", noteToJson(result.note))
        .put("similarity", result.similarity)

fun searchResultFromJson(json: JSONObject): SemanticSearchResult =
    SemanticSearchResult(
        note = noteFromJson(json.getJSONObject("note")),
        similarity = json.getDouble("similarity"),
    )

fun notesToJson(notes: List<NoteRecord>): String =
    JSONArray().apply { notes.forEach { put(noteToJson(it)) } }.toString()

fun notesFromJson(raw: String?): List<NoteRecord> {
    return safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) {
                add(noteFromJson(array.getJSONObject(index)))
            }
        }
    }
}

fun tagsToJson(tags: List<TagRecord>): String =
    JSONArray().apply { tags.forEach { put(tagToJson(it)) } }.toString()

fun tagsFromJson(raw: String?): List<TagRecord> {
    return safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) {
                add(tagFromJson(array.getJSONObject(index)))
            }
        }
    }
}

fun categoriesToJson(categories: List<CategoryRecord>): String =
    JSONArray().apply { categories.forEach { put(categoryToJson(it)) } }.toString()

fun categoriesFromJson(raw: String?): List<CategoryRecord> {
    return safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) {
                add(categoryFromJson(array.getJSONObject(index)))
            }
        }
    }
}

fun workspacesToJson(workspaces: List<WorkspaceRecord>): String =
    JSONArray().apply { workspaces.forEach { put(workspaceToJson(it)) } }.toString()

fun workspacesFromJson(raw: String?): List<WorkspaceRecord> =
    safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) add(workspaceFromJson(array.getJSONObject(index)))
        }
    }

fun statusesToJson(statuses: List<StatusRecord>): String =
    JSONArray().apply { statuses.forEach { put(statusToJson(it)) } }.toString()

fun statusesFromJson(raw: String?): List<StatusRecord> =
    safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) add(statusFromJson(array.getJSONObject(index)))
        }
    }

fun searchResultsToJson(results: List<SemanticSearchResult>): String =
    JSONArray().apply { results.forEach { put(searchResultToJson(it)) } }.toString()

fun searchResultsFromJson(raw: String?): List<SemanticSearchResult> {
    return safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) {
                add(searchResultFromJson(array.getJSONObject(index)))
            }
        }
    }
}
