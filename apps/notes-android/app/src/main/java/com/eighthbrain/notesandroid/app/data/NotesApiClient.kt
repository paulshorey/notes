package com.eighthbrain.notesandroid.app.data

import com.eighthbrain.notesandroid.app.model.CategoryRecord
import com.eighthbrain.notesandroid.app.model.NoteDraft
import com.eighthbrain.notesandroid.app.model.NoteRecord
import com.eighthbrain.notesandroid.app.model.SemanticSearchResult
import com.eighthbrain.notesandroid.app.model.TagRecord
import com.eighthbrain.notesandroid.app.model.UserSummary
import com.eighthbrain.notesandroid.app.model.parseOptionalLocalInputToIso
import org.json.JSONObject.NULL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class NotesApiClient(
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    suspend fun login(
        baseUrl: String,
        identifier: String,
    ): UserSummary =
        withContext(Dispatchers.IO) {
            val requestBody =
                JSONObject()
                    .put("identifier", identifier.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "session"),
                    method = "POST",
                    requestBody = requestBody,
                )

            applyUserSummaryDefaults(response.getJSONObject("user"))
            userFromJson(response.getJSONObject("user"))
        }

    suspend fun getUser(
        baseUrl: String,
        userId: Int,
    ): UserSummary =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "session"),
                    queryParameters = listOf("userId" to userId.toString()),
                )

            applyUserSummaryDefaults(response.getJSONObject("user"))
            userFromJson(response.getJSONObject("user"))
        }

    suspend fun listNotes(
        baseUrl: String,
        userId: Int,
    ): List<NoteRecord> =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "notes"),
                    queryParameters = listOf("userId" to userId.toString()),
                )

            val notesArray = response.getJSONArray("notes")
            buildList {
                for (index in 0 until notesArray.length()) {
                    add(noteFromJson(notesArray.getJSONObject(index)))
                }
            }
        }

    suspend fun listTags(
        baseUrl: String,
        userId: Int,
    ): List<TagRecord> =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "tags"),
                    queryParameters = listOf("userId" to userId.toString()),
                )

            val tagsArray = response.getJSONArray("tags")
            buildList {
                for (index in 0 until tagsArray.length()) {
                    add(tagFromJson(tagsArray.getJSONObject(index)))
                }
            }
        }

    suspend fun listCategories(
        baseUrl: String,
        userId: Int,
    ): List<CategoryRecord> =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "categories"),
                    queryParameters = listOf("userId" to userId.toString()),
                )

            val categoriesArray = response.getJSONArray("categories")
            buildList {
                for (index in 0 until categoriesArray.length()) {
                    add(categoryFromJson(categoriesArray.getJSONObject(index)))
                }
            }
        }

    suspend fun saveNote(
        baseUrl: String,
        userId: Int,
        noteId: Int?,
        noteDraft: NoteDraft,
    ): NoteRecord =
        withContext(Dispatchers.IO) {
            val tagIdsJson = JSONArray()
            noteDraft.selectedTagIds.forEach { tagIdsJson.put(it) }

            val noteJson =
                JSONObject()
                    .put("categoryId", noteDraft.selectedCategoryId)
                    .put("tagIds", tagIdsJson)
                    .put("description", noteDraft.description)
                    .put("timeDue", parseOptionalLocalInputToIso(noteDraft.dueInput, "Due time") ?: NULL)
                    .put("timeRemind", parseOptionalLocalInputToIso(noteDraft.remindInput, "Reminder time") ?: NULL)

            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("note", noteJson)

            if (noteId != null) {
                payload.put("noteId", noteId)
            }

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "notes"),
                    method = if (noteId == null) "POST" else "PATCH",
                    requestBody = payload.toString().toRequestBody(jsonMediaType),
                )

            noteFromJson(response.getJSONObject("note"))
        }

    suspend fun createCategory(
        baseUrl: String,
        userId: Int,
        label: String,
    ): CategoryRecord =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("label", label.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "categories"),
                    method = "POST",
                    requestBody = payload,
                )

            categoryFromJson(response.getJSONObject("category"))
        }

    suspend fun updateCategory(
        baseUrl: String,
        userId: Int,
        categoryId: Int,
        label: String,
    ): CategoryRecord =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("categoryId", categoryId)
                    .put("label", label.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "categories"),
                    method = "PATCH",
                    requestBody = payload,
                )

            categoryFromJson(response.getJSONObject("category"))
        }

    suspend fun deleteCategory(
        baseUrl: String,
        userId: Int,
        categoryId: Int,
    ) {
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("categoryId", categoryId)
                    .toString()
                    .toRequestBody(jsonMediaType)

            execute(
                baseUrl = normalizeBaseUrl(baseUrl),
                pathSegments = listOf("api", "categories"),
                method = "DELETE",
                requestBody = payload,
            )
        }
    }

    suspend fun createTag(
        baseUrl: String,
        userId: Int,
        label: String,
    ): TagRecord =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("label", label.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "tags"),
                    method = "POST",
                    requestBody = payload,
                )

            tagFromJson(response.getJSONObject("tag"))
        }

    suspend fun updateTag(
        baseUrl: String,
        userId: Int,
        tagId: Int,
        label: String,
    ): TagRecord =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("tagId", tagId)
                    .put("label", label.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "tags"),
                    method = "PATCH",
                    requestBody = payload,
                )

            tagFromJson(response.getJSONObject("tag"))
        }

    suspend fun deleteTag(
        baseUrl: String,
        userId: Int,
        tagId: Int,
    ): Int =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("tagId", tagId)
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "tags"),
                    method = "DELETE",
                    requestBody = payload,
                )

            response.optInt("deletedLinks", 0)
        }

    suspend fun deleteNote(
        baseUrl: String,
        userId: Int,
        noteId: Int,
    ) {
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("noteId", noteId)
                    .toString()
                    .toRequestBody(jsonMediaType)

            execute(
                baseUrl = normalizeBaseUrl(baseUrl),
                pathSegments = listOf("api", "notes"),
                method = "DELETE",
                requestBody = payload,
            )
        }
    }

    suspend fun semanticSearch(
        baseUrl: String,
        userId: Int,
        query: String,
        limit: Int = 12,
    ): List<SemanticSearchResult> =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("query", query.trim())
                    .put("limit", limit)
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "notes", "search"),
                    method = "POST",
                    requestBody = payload,
                )

            val resultsArray = response.getJSONArray("results")
            buildList {
                for (index in 0 until resultsArray.length()) {
                    add(searchResultFromJson(resultsArray.getJSONObject(index)))
                }
            }
        }

    fun normalizeBaseUrl(value: String): String {
        val trimmed = value.trim().removeSuffix("/")
        require(trimmed.isNotEmpty()) { "Server URL is required." }
        require(trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            "Server URL must start with http:// or https://."
        }

        trimmed.toHttpUrlOrNull()
            ?: throw IllegalArgumentException("Server URL is not valid.")

        return trimmed
    }

    private fun execute(
        baseUrl: String,
        pathSegments: List<String>,
        method: String = "GET",
        requestBody: okhttp3.RequestBody? = null,
        queryParameters: List<Pair<String, String>> = emptyList(),
    ): JSONObject {
        val baseHttpUrl =
            baseUrl.toHttpUrlOrNull() ?: throw IllegalArgumentException("Server URL is not valid.")
        val urlBuilder = baseHttpUrl.newBuilder()

        pathSegments.forEach { segment ->
            urlBuilder.addPathSegment(segment)
        }

        queryParameters.forEach { (key, value) ->
            urlBuilder.addQueryParameter(key, value)
        }

        val requestBuilder =
            Request.Builder()
                .url(urlBuilder.build())
                .header("Accept", "application/json")

        if (method == "GET") {
            requestBuilder.get()
        } else {
            requestBuilder.method(method, requestBody)
            requestBuilder.header("Content-Type", "application/json")
        }

        httpClient.newCall(requestBuilder.build()).execute().use { response ->
            val bodyText = response.body.string()
            val payload = bodyText.takeIf { it.isNotBlank() }?.let(::JSONObject) ?: JSONObject()

            if (!response.isSuccessful) {
                val errorMessage = payload.optString("error").ifBlank { "Request failed." }
                throw IllegalStateException(errorMessage)
            }

            return payload
        }
    }

    companion object {
        private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    }
}
