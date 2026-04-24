import assert from "node:assert/strict"
import { test } from "node:test"
import type { NotesAppService } from "../services/notes-app"

type RequestOptions = {
  body?: unknown
  headers?: Record<string, string>
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
}

type ResponsePayload = {
  body: unknown
  status: number
}

export type NotesApiAdapter = {
  close?: () => Promise<void> | void
  request: (options: RequestOptions) => Promise<ResponsePayload>
}

type AdapterFactory = (
  service: NotesAppService,
) => Promise<NotesApiAdapter> | NotesApiAdapter

const sampleUser = {
  id: 7,
  username: "admin",
  email: "admin@example.com",
  phone: "5550100",
}

const sampleNote = {
  id: 41,
  userId: sampleUser.id,
  category: { id: 5, label: "work" },
  tags: [
    { id: 12, label: "verify both http adapters" },
  ],
  description: "The Next and Express routes should stay behaviorally aligned.",
  timeDue: "2026-03-18T16:00:00.000Z",
  timeRemind: "2026-03-18T15:30:00.000Z",
  timeCreated: "2026-03-17T10:00:00.000Z",
  timeModified: "2026-03-17T10:05:00.000Z",
}

const sampleSearchResult = {
  note: sampleNote,
  similarity: 0.94,
  tagSimilarity: 0.89,
  descriptionSimilarity: 0.85,
}

const sampleTag = {
  id: 12,
  userId: sampleUser.id,
  label: "verify both http adapters",
  noteCount: 0,
  lastUsedAt: null,
}

const sampleCategory = {
  id: 5,
  userId: sampleUser.id,
  label: "work",
  noteCount: 1,
  lastUsedAt: sampleNote.timeModified,
}

const sampleEmbeddingMaintenanceResponse = {
  mode: "missing",
  processed: 3,
  updated: 3,
  categoriesUpdated: 0,
  tagsUpdated: 0,
  hasMore: false,
}

export const createFakeNotesAppService = (
  overrides: Partial<NotesAppService> = {},
): NotesAppService => ({
  getNotesAppErrorStatus: () => 400,
  getNotesAppSession: async () => ({ user: sampleUser }),
  findNotesAppSession: async () => ({ user: sampleUser }),
  listNotesForNotesApp: async () => ({ notes: [sampleNote] }),
  listCategoriesForNotesApp: async () => ({ categories: [sampleCategory] }),
  createCategoryForNotesApp: async () => ({ category: sampleCategory }),
  updateCategoryForNotesApp: async () => ({ category: sampleCategory }),
  deleteCategoryForNotesApp: async () => ({ ok: true }),
  listTagsForNotesApp: async () => ({ tags: [sampleTag] }),
  createTagForNotesApp: async () => ({ tag: sampleTag }),
  updateTagForNotesApp: async () => ({ tag: sampleTag }),
  deleteTagForNotesApp: async () => ({ ok: true, deletedLinks: 0 }),
  createNoteForNotesApp: async () => ({ note: sampleNote }),
  updateNoteForNotesApp: async () => ({ note: sampleNote }),
  deleteNoteForNotesApp: async () => ({ ok: true }),
  searchNotesForNotesApp: async () => ({ results: [sampleSearchResult] }),
  maintainNoteEmbeddingsForNotesApp: async () => sampleEmbeddingMaintenanceResponse,
  ...overrides,
})

const readError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined

export const registerNotesApiAdapterSuite = (
  adapterName: string,
  createAdapter: AdapterFactory,
) => {
  test(`${adapterName} adapter parity`, async (t) => {
    t.diagnostic(
      "Verifies that Notes API route semantics stay aligned across the Next and Express adapters.",
    )
  })

  test(`${adapterName} login trims identifiers`, async (t) => {
    const requests: Array<{ identifier: string }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        findNotesAppSession: async (request) => {
          requests.push(request)
          return { user: sampleUser }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/session",
      body: { identifier: "  admin  " },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { user: sampleUser })
    assert.deepEqual(requests, [{ identifier: "admin" }])
  })

  test(`${adapterName} returns 404 for missing session login`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        findNotesAppSession: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/session",
      body: { identifier: "missing-user" },
    })

    assert.equal(response.status, 404)
    assert.equal(
      readError(response.body),
      "No matching user was found. Enter an existing username, email, or phone number.",
    )
  })

  test(`${adapterName} validates session lookup query params`, async (t) => {
    const adapter = await createAdapter(createFakeNotesAppService())

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/session?userId=0",
    })

    assert.equal(response.status, 400)
    assert.equal(readError(response.body), "userId must be an integer of at least 1.")
  })

  test(`${adapterName} returns 404 when a stored session user is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        getNotesAppSession: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/session?userId=7",
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "User not found.")
  })

  test(`${adapterName} lists notes for the requested user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        listNotesForNotesApp: async (request) => {
          requests.push(request)
          return { notes: [sampleNote] }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/notes?userId=7",
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { notes: [sampleNote] })
    assert.deepEqual(requests, [{ userId: 7 }])
  })

  test(`${adapterName} lists tags for the requested user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        listTagsForNotesApp: async (request) => {
          requests.push(request)
          return { tags: [sampleTag] }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/tags?userId=7",
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { tags: [sampleTag] })
    assert.deepEqual(requests, [{ userId: 7 }])
  })

  test(`${adapterName} lists categories for the requested user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        listCategoriesForNotesApp: async (request) => {
          requests.push(request)
          return { categories: [sampleCategory] }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/categories?userId=7",
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { categories: [sampleCategory] })
    assert.deepEqual(requests, [{ userId: 7 }])
  })

  test(`${adapterName} lowercases category labels before create and update`, async (t) => {
    const createRequests: Array<{ userId: number; label: string }> = []
    const updateRequests: Array<{ userId: number; categoryId: number; label: string }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        createCategoryForNotesApp: async (request) => {
          createRequests.push(request)
          return { category: sampleCategory }
        },
        updateCategoryForNotesApp: async (request) => {
          updateRequests.push(request)
          return { category: sampleCategory }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const createResponse = await adapter.request({
      method: "POST",
      path: "/api/categories",
      body: { userId: 7, label: "  Work  " },
    })
    const updateResponse = await adapter.request({
      method: "PATCH",
      path: "/api/categories",
      body: { userId: 7, categoryId: 5, label: "  WORK  " },
    })

    assert.equal(createResponse.status, 201)
    assert.equal(updateResponse.status, 200)
    assert.deepEqual(createRequests, [{ userId: 7, label: "work" }])
    assert.deepEqual(updateRequests, [{ userId: 7, categoryId: 5, label: "work" }])
  })

  test(`${adapterName} lowercases tag labels before create and update`, async (t) => {
    const createRequests: Array<{ userId: number; label: string }> = []
    const updateRequests: Array<{ userId: number; tagId: number; label: string }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        createTagForNotesApp: async (request) => {
          createRequests.push(request)
          return { tag: sampleTag }
        },
        updateTagForNotesApp: async (request) => {
          updateRequests.push(request)
          return { tag: sampleTag }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const createResponse = await adapter.request({
      method: "POST",
      path: "/api/tags",
      body: { userId: 7, label: "  Verify Both HTTP Adapters  " },
    })
    const updateResponse = await adapter.request({
      method: "PATCH",
      path: "/api/tags",
      body: { userId: 7, tagId: 12, label: "  VERIFY BOTH HTTP ADAPTERS  " },
    })

    assert.equal(createResponse.status, 201)
    assert.equal(updateResponse.status, 200)
    assert.deepEqual(createRequests, [{ userId: 7, label: "verify both http adapters" }])
    assert.deepEqual(updateRequests, [
      { userId: 7, tagId: 12, label: "verify both http adapters" },
    ])
  })

  test(`${adapterName} creates notes with a 201 response`, async (t) => {
    const requests: Array<unknown> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        createNoteForNotesApp: async (request) => {
          requests.push(request)
          return { note: sampleNote }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes",
      body: {
        userId: 7,
        note: {
          categoryId: 5,
          tagIds: [12],
          description: "The Next and Express routes should stay behaviorally aligned.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    })

    assert.equal(response.status, 201)
    assert.deepEqual(response.body, { note: sampleNote })
    assert.deepEqual(requests, [
      {
        userId: 7,
        note: {
          categoryId: 5,
          tagIds: [12],
          description: "The Next and Express routes should stay behaviorally aligned.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    ])
  })

  test(`${adapterName} returns 404 when an update target is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        updateNoteForNotesApp: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "PATCH",
      path: "/api/notes",
      body: {
        userId: 7,
        noteId: 999,
        note: {
          categoryId: 5,
          tagIds: [12],
          description: "The Next and Express routes should stay behaviorally aligned.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "Note not found.")
  })

  test(`${adapterName} returns 404 when a delete target is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        deleteNoteForNotesApp: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "DELETE",
      path: "/api/notes",
      body: {
        userId: 7,
        noteId: 999,
      },
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "Note not found.")
  })

  test(`${adapterName} maps search failures through the shared status helper`, async (t) => {
    const adapter = await createAdapter(
      createFakeNotesAppService({
        getNotesAppErrorStatus: () => 502,
        searchNotesForNotesApp: async () => {
          throw new Error("Embedding provider failed.")
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes/search",
      body: {
        userId: 7,
        query: "adapter parity",
        limit: 12,
      },
    })

    assert.equal(response.status, 502)
    assert.equal(readError(response.body), "Embedding provider failed.")
  })

  test(`${adapterName} lowercases search queries`, async (t) => {
    const requests: Array<{ userId: number; query: string; limit: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        searchNotesForNotesApp: async (request) => {
          requests.push(request)
          return { results: [sampleSearchResult] }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes/search",
      body: {
        userId: 7,
        query: "  Adapter Parity  ",
        limit: 12,
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { results: [sampleSearchResult] })
    assert.deepEqual(requests, [{ userId: 7, query: "adapter parity", limit: 12 }])
  })

  test(`${adapterName} runs embedding maintenance in missing mode`, async (t) => {
    const requests: Array<{ userId: number; mode: string; limit: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        maintainNoteEmbeddingsForNotesApp: async (request) => {
          requests.push(request)
          return sampleEmbeddingMaintenanceResponse
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes/maintenance/embeddings",
      body: {
        userId: 7,
        mode: "missing",
        limit: 25,
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, sampleEmbeddingMaintenanceResponse)
    assert.deepEqual(requests, [{ userId: 7, mode: "missing", limit: 25 }])
  })

  test(`${adapterName} validates embedding maintenance mode`, async (t) => {
    const adapter = await createAdapter(createFakeNotesAppService())

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes/maintenance/embeddings",
      body: {
        userId: 7,
        mode: "invalid",
      },
    })

    assert.equal(response.status, 400)
    assert.equal(readError(response.body), 'mode must be "missing" or "stale".')
  })

  test(`${adapterName} runs embedding maintenance in stale mode`, async (t) => {
    const requests: Array<{ userId: number; mode: string; limit: number }> = []
    const adapter = await createAdapter(
      createFakeNotesAppService({
        maintainNoteEmbeddingsForNotesApp: async (request) => {
          requests.push(request)
          return {
            mode: "stale",
            processed: 2,
            updated: 2,
            categoriesUpdated: 0,
            tagsUpdated: 0,
            hasMore: true,
          }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/notes/maintenance/embeddings",
      body: {
        userId: 7,
        mode: "stale",
        limit: 2,
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, {
      mode: "stale",
      processed: 2,
      updated: 2,
      categoriesUpdated: 0,
      tagsUpdated: 0,
      hasMore: true,
    })
    assert.deepEqual(requests, [{ userId: 7, mode: "stale", limit: 2 }])
  })
}
