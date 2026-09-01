package com.eighthbrain.notesandroid.app.data

import com.eighthbrain.notesandroid.app.model.TaxonomyRecord
import com.eighthbrain.notesandroid.app.model.TaxonomyLevelRecord
import com.eighthbrain.notesandroid.app.model.LoginSession
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
        password: String,
    ): LoginSession =
        withContext(Dispatchers.IO) {
            val requestBody =
                JSONObject()
                    .put("identifier", identifier.trim())
                    .put("password", password)
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "auth", "token"),
                    method = "POST",
                    requestBody = requestBody,
                )

            applyUserSummaryDefaults(response.getJSONObject("user"))
            LoginSession(
                token = response.getString("token"),
                user = userFromJson(response.getJSONObject("user")),
            )
        }

    suspend fun logout(
        baseUrl: String,
        token: String,
    ) {
        withContext(Dispatchers.IO) {
            execute(
                baseUrl = normalizeBaseUrl(baseUrl),
                pathSegments = listOf("api", "auth", "token"),
                method = "DELETE",
                token = token,
            )
        }
    }

    suspend fun getUser(
        baseUrl: String,
        token: String,
    ): UserSummary =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "session"),
                    token = token,
                )

            applyUserSummaryDefaults(response.getJSONObject("user"))
            userFromJson(response.getJSONObject("user"))
        }

    suspend fun listNotes(
        baseUrl: String,
        token: String,
    ): List<NoteRecord> =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "notes"),
                    token = token,
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
        token: String,
    ): List<TagRecord> =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "tags"),
                    token = token,
                )

            val tagsArray = response.getJSONArray("tags")
            buildList {
                for (index in 0 until tagsArray.length()) {
                    add(tagFromJson(tagsArray.getJSONObject(index)))
                }
            }
        }

    /** The whole tree and this user's tier vocabulary, in one call. */
    suspend fun listTaxonomy(
        baseUrl: String,
        token: String,
    ): Pair<List<TaxonomyRecord>, List<TaxonomyLevelRecord>> =
        withContext(Dispatchers.IO) {
            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "taxonomy"),
                    token = token,
                )

            val nodesArray = response.getJSONArray("taxonomy")
            val nodes = buildList {
                for (index in 0 until nodesArray.length()) {
                    add(taxonomyFromJson(nodesArray.getJSONObject(index)))
                }
            }

            val levelsArray = response.getJSONArray("levels")
            val levels = buildList {
                for (index in 0 until levelsArray.length()) {
                    add(taxonomyLevelFromJson(levelsArray.getJSONObject(index)))
                }
            }

            nodes to levels
        }

    suspend fun saveNote(
        baseUrl: String,
        token: String,
        userId: Int,
        noteId: Int?,
        noteDraft: NoteDraft,
    ): NoteRecord =
        withContext(Dispatchers.IO) {
            val tagIdsJson = JSONArray()
            noteDraft.selectedTagIds.forEach { tagIdsJson.put(it) }

            val noteJson =
                JSONObject()
                    .put("groupId", noteDraft.selectedGroupId)
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
                    token = token,
                )

            noteFromJson(response.getJSONObject("note"))
        }

    /**
     * Create a group under [parentCategoryId]. Levels are numbers, never names:
     * 3 is the group tier regardless of what this user calls it.
     */
    suspend fun createGroup(
        baseUrl: String,
        token: String,
        userId: Int,
        parentCategoryId: Int,
        label: String,
    ): TaxonomyRecord =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("level", 3)
                    .put("parentId", parentCategoryId)
                    .put("label", label.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "taxonomy"),
                    method = "POST",
                    requestBody = payload,
                    token = token,
                )

            taxonomyFromJson(response.getJSONObject("taxonomy"))
        }

    suspend fun renameTaxonomy(
        baseUrl: String,
        token: String,
        userId: Int,
        taxonomyId: Int,
        label: String,
    ): TaxonomyRecord =
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("taxonomyId", taxonomyId)
                    .put("label", label.trim())
                    .toString()
                    .toRequestBody(jsonMediaType)

            val response =
                execute(
                    baseUrl = normalizeBaseUrl(baseUrl),
                    pathSegments = listOf("api", "taxonomy"),
                    method = "PATCH",
                    requestBody = payload,
                    token = token,
                )

            taxonomyFromJson(response.getJSONObject("taxonomy"))
        }

    /**
     * [mode] is required by the server: guessing between moving a node's
     * contents and deleting them is not a call the client gets to make.
     */
    suspend fun deleteTaxonomy(
        baseUrl: String,
        token: String,
        userId: Int,
        taxonomyId: Int,
        mode: String = "reassign-children",
    ) {
        withContext(Dispatchers.IO) {
            val payload =
                JSONObject()
                    .put("userId", userId)
                    .put("taxonomyId", taxonomyId)
                    .put("mode", mode)
                    .toString()
                    .toRequestBody(jsonMediaType)

            execute(
                baseUrl = normalizeBaseUrl(baseUrl),
                pathSegments = listOf("api", "taxonomy"),
                method = "DELETE",
                requestBody = payload,
                token = token,
            )
        }
    }

    suspend fun createTag(
        baseUrl: String,
        token: String,
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
                    token = token,
                )

            tagFromJson(response.getJSONObject("tag"))
        }

    suspend fun updateTag(
        baseUrl: String,
        token: String,
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
                    token = token,
                )

            tagFromJson(response.getJSONObject("tag"))
        }

    suspend fun deleteTag(
        baseUrl: String,
        token: String,
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
                    token = token,
                )

            response.optInt("deletedLinks", 0)
        }

    suspend fun deleteNote(
        baseUrl: String,
        token: String,
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
                token = token,
            )
        }
    }

    suspend fun semanticSearch(
        baseUrl: String,
        token: String,
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
                    token = token,
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
        token: String? = null,
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

        if (token != null) {
            requestBuilder.header("Authorization", "Bearer $token")
        }

        if (method == "GET") {
            requestBuilder.get()
        } else {
            requestBuilder.method(method, requestBody)
            if (requestBody != null) {
                requestBuilder.header("Content-Type", "application/json")
            }
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
