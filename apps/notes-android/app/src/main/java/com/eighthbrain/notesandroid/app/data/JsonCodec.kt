package com.eighthbrain.notesandroid.app.data

import com.eighthbrain.notesandroid.app.model.CategoryRecord
import com.eighthbrain.notesandroid.app.model.NoteCategoryRef
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

fun categoryToJson(category: CategoryRecord): JSONObject =
    JSONObject()
        .put("id", category.id)
        .put("userId", category.userId)
        .put("label", category.label)
        .put("noteCount", category.noteCount)
        .put("lastUsedAt", category.lastUsedAt)

fun categoryFromJson(json: JSONObject): CategoryRecord =
    CategoryRecord(
        id = json.getInt("id"),
        userId = json.getInt("userId"),
        label = json.getString("label"),
        noteCount = json.optInt("noteCount", 0),
        lastUsedAt = json.stringOrNull("lastUsedAt"),
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

private fun noteCategoryRefToJson(category: NoteCategoryRef): JSONObject =
    JSONObject()
        .put("id", category.id)
        .put("label", category.label)

private fun noteCategoryRefFromJson(json: JSONObject): NoteCategoryRef =
    NoteCategoryRef(
        id = json.getInt("id"),
        label = json.getString("label"),
    )

private fun noteCategoryRefFromLegacyJson(json: JSONObject): NoteCategoryRef =
    NoteCategoryRef(
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

private fun categoryFromNoteJson(json: JSONObject): NoteCategoryRef {
    if (json.has("category") && !json.isNull("category")) {
        return noteCategoryRefFromJson(json.getJSONObject("category"))
    }
    if (json.has("categories") && !json.isNull("categories")) {
        val categories = json.getJSONArray("categories")
        if (categories.length() > 0) {
            return noteCategoryRefFromLegacyJson(categories.getJSONObject(0))
        }
    }
    return NoteCategoryRef(id = -1, label = "Unknown")
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
        .put("category", noteCategoryRefToJson(note.category))
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
        category = categoryFromNoteJson(json),
        tags = tagsArrayFromJson(json),
        description = json.stringOrNull("description"),
        timeDue = json.getString("timeDue"),
        timeRemind = json.getString("timeRemind"),
        timeCreated = json.getString("timeCreated"),
        timeModified = json.getString("timeModified"),
    )

fun searchResultToJson(result: SemanticSearchResult): JSONObject =
    JSONObject()
        .put("note", noteToJson(result.note))
        .put("similarity", result.similarity)
        .put("tagSimilarity", result.tagSimilarity)
        .put("descriptionSimilarity", result.descriptionSimilarity)

fun searchResultFromJson(json: JSONObject): SemanticSearchResult =
    SemanticSearchResult(
        note = noteFromJson(json.getJSONObject("note")),
        similarity = json.getDouble("similarity"),
        tagSimilarity = json.doubleOrNull("tagSimilarity"),
        descriptionSimilarity = json.doubleOrNull("descriptionSimilarity"),
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
