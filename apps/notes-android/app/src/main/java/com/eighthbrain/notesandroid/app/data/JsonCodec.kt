package com.eighthbrain.notesandroid.app.data

import com.eighthbrain.notesandroid.app.model.TaxonomyRecord
import com.eighthbrain.notesandroid.app.model.TaxonomyLevelRecord
import com.eighthbrain.notesandroid.app.model.NotesAppPreferences
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.NoteTagRef
import com.eighthbrain.notesandroid.app.model.SemanticSearchResult
import com.eighthbrain.notesandroid.app.model.TagRecord
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

fun taxonomyToJson(node: TaxonomyRecord): JSONObject =
    JSONObject()
        .put("id", node.id)
        .put("userId", node.userId)
        .put("level", node.level)
        .put("parentId", node.parentId)
        .put("label", node.label)
        .put("noteCount", node.noteCount)
        .put("directNoteCount", node.directNoteCount)
        .put("lastUsedAt", node.lastUsedAt)

fun taxonomyFromJson(json: JSONObject): TaxonomyRecord =
    TaxonomyRecord(
        id = json.getInt("id"),
        userId = json.getInt("userId"),
        level = json.getInt("level"),
        parentId = json.intOrNull("parentId"),
        label = json.getString("label"),
        noteCount = json.optInt("noteCount", 0),
        directNoteCount = json.optInt("directNoteCount", 0),
        lastUsedAt = json.stringOrNull("lastUsedAt"),
    )

fun taxonomyLevelToJson(level: TaxonomyLevelRecord): JSONObject =
    JSONObject()
        .put("userId", level.userId)
        .put("level", level.level)
        .put("label", level.label)

fun taxonomyLevelFromJson(json: JSONObject): TaxonomyLevelRecord =
    TaxonomyLevelRecord(
        userId = json.getInt("userId"),
        level = json.getInt("level"),
        label = json.getString("label"),
    )

fun tagToJson(tag: TagRecord): JSONObject =
    JSONObject()
        .put("id", tag.id)
        .put("userId", tag.userId)
        .put("label", tag.label)
        .put("noteCount", tag.noteCount)
        .put("lastUsedAt", tag.lastUsedAt)

fun tagFromJson(json: JSONObject): TagRecord =
    TagRecord(
        id = json.getInt("id"),
        userId = json.getInt("userId"),
        label = json.getString("label"),
        noteCount = json.optInt("noteCount", 0),
        lastUsedAt = json.stringOrNull("lastUsedAt"),
    )

private fun noteTagRefFromJson(json: JSONObject): NoteTagRef =
    NoteTagRef(
        id = json.getInt("id"),
        label = json.getString("label"),
    )

private fun tagsArrayFromJson(json: JSONObject): List<NoteTagRef> {
    val array =
        when {
            json.has("tags") && !json.isNull("tags") -> json.getJSONArray("tags")
            json.has("categories") && !json.isNull("categories") -> json.getJSONArray("categories")
            else -> return emptyList()
        }
    return buildList {
        for (index in 0 until array.length()) {
            add(noteTagRefFromJson(array.getJSONObject(index)))
        }
    }
}

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
        .put("userId", note.userId)
        .put("groupId", note.groupId)
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
        userId = json.getInt("userId"),
        groupId = json.getInt("groupId"),
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

fun taxonomyListToJson(nodes: List<TaxonomyRecord>): String =
    JSONArray().apply { nodes.forEach { put(taxonomyToJson(it)) } }.toString()

fun taxonomyListFromJson(raw: String?): List<TaxonomyRecord> {
    return safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) {
                add(taxonomyFromJson(array.getJSONObject(index)))
            }
        }
    }
}

fun taxonomyLevelsToJson(levels: List<TaxonomyLevelRecord>): String =
    JSONArray().apply { levels.forEach { put(taxonomyLevelToJson(it)) } }.toString()

fun taxonomyLevelsFromJson(raw: String?): List<TaxonomyLevelRecord> {
    return safeDecodeList(raw) { array ->
        buildList {
            for (index in 0 until array.length()) {
                add(taxonomyLevelFromJson(array.getJSONObject(index)))
            }
        }
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
