import assert from "node:assert/strict"
import { test } from "node:test"
import type { ItemsAppService } from "../services/items-app"

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

export type ItemsApiAdapter = {
  close?: () => Promise<void> | void
  request: (options: RequestOptions) => Promise<ResponsePayload>
}

type AdapterFactory = (service: ItemsAppService) => Promise<ItemsApiAdapter> | ItemsApiAdapter

const sampleUser = {
  id: 7,
  username: "admin",
  email: "admin@example.com",
  phone: "5550100",
  preferences: {
    notesApp: {
      resultsColumnWidth: 420,
    },
  },
}

const sampleItem = {
  id: 41,
  workspaceId: 3,
  categories: [{ id: 5, label: "work" }],
  status: null,
  tags: [{ id: 12, label: "verify the http api contract" }],
  description: "The Notes API routes should follow the shared contract.",
  timeDue: "2026-03-18T16:00:00.000Z",
  timeRemind: "2026-03-18T15:30:00.000Z",
  timeCreated: "2026-03-17T10:00:00.000Z",
  timeModified: "2026-03-17T10:05:00.000Z",
}

const sampleSearchResult = {
  item: sampleItem,
  similarity: 0.94,
}

const sampleTag = {
  id: 12,
  workspaceId: 3,
  label: "verify the http api contract",
  itemCount: 0,
  lastUsedAt: null,
}

const sampleCategory = {
  id: 5,
  workspaceId: 3,
  label: "work",
  itemCount: 1,
  lastUsedAt: sampleItem.timeModified,
}

const sampleWorkspace = {
  id: 3,
  userId: sampleUser.id,
  label: "personal",
  itemCount: 1,
}

const sampleStatus = {
  id: 8,
  workspaceId: 3,
  label: "backlog",
  position: 0,
  itemCount: 0,
  lastUsedAt: null,
}

const sampleEmbeddingMaintenanceResponse = {
  mode: "missing",
  processed: 3,
  updated: 3,
  categoriesUpdated: 0,
  tagsUpdated: 0,
  hasMore: false,
}

export const sampleApiToken = "nta_test_token"

const authHeaders = { Authorization: `Bearer ${sampleApiToken}` }

export const createFakeItemsAppService = (
  overrides: Partial<ItemsAppService> = {},
): ItemsAppService => ({
  exportUserBackup: async () => {
    throw new Error("Backup not configured in this test.")
  },
  restoreUserBackup: async () => ({ itemsImported: 0, itemsSkipped: 0 }),
  getItemsAppErrorStatus: () => 400,
  getItemsAppSession: async () => ({ user: sampleUser }),
  loginItemsAppUser: async () => ({ token: sampleApiToken, user: sampleUser }),
  getItemsAppUserIdForToken: async ({ token }) => (token === sampleApiToken ? sampleUser.id : null),
  revokeItemsAppToken: async ({ token }) => token === sampleApiToken,
  updateItemsAppUserPreferences: async () => ({ user: sampleUser }),
  listWorkspacesForItemsApp: async () => ({ workspaces: [sampleWorkspace] }),
  createWorkspaceForItemsApp: async () => ({ workspace: sampleWorkspace }),
  updateWorkspaceForItemsApp: async () => ({ workspace: sampleWorkspace }),
  deleteWorkspaceForItemsApp: async () => ({ ok: true }),
  listItemsForItemsApp: async () => ({ items: [sampleItem] }),
  listCategoriesForItemsApp: async () => ({ categories: [sampleCategory] }),
  createCategoryForItemsApp: async () => ({ category: sampleCategory }),
  updateCategoryForItemsApp: async () => ({ category: sampleCategory }),
  deleteCategoryForItemsApp: async () => ({ ok: true }),
  listStatusesForItemsApp: async () => ({ statuses: [sampleStatus] }),
  createStatusForItemsApp: async () => ({ status: sampleStatus }),
  updateStatusForItemsApp: async () => ({ status: sampleStatus }),
  deleteStatusForItemsApp: async () => ({ ok: true }),
  listTagsForItemsApp: async () => ({ tags: [sampleTag] }),
  createTagForItemsApp: async () => ({ tag: sampleTag }),
  updateTagForItemsApp: async () => ({ tag: sampleTag }),
  deleteTagForItemsApp: async () => ({ ok: true, deletedLinks: 0 }),
  createItemForItemsApp: async () => ({ item: sampleItem }),
  updateItemForItemsApp: async () => ({ item: sampleItem }),
  deleteItemForItemsApp: async () => ({ ok: true }),
  searchItemsForItemsApp: async () => ({ results: [sampleSearchResult] }),
  maintainItemEmbeddingsForItemsApp: async () => sampleEmbeddingMaintenanceResponse,
  createAnonymousItemsAppSession: async () => ({ user: sampleUser }),
  claimAnonymousItemsAppSession: async () => ({ user: sampleUser }),
  mergeAnonymousItemsAppSession: async () => ({ user: sampleUser }),
  ...overrides,
})

const readError = (body: unknown) =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : undefined

export const registerItemsApiAdapterSuite = (
  adapterName: string,
  createAdapter: AdapterFactory,
) => {
  test(`${adapterName} adapter parity`, async (t) => {
    t.diagnostic("Verifies that Notes API route semantics follow the shared service contract.")
  })

  test(`${adapterName} token login trims identifiers and returns a token`, async (t) => {
    const requests: Array<{ identifier: string; password: string }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        loginItemsAppUser: async (request) => {
          requests.push(request)
          return { token: sampleApiToken, user: sampleUser }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/auth/token",
      body: { identifier: "  admin  ", password: "correct horse" },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { token: sampleApiToken, user: sampleUser })
    assert.deepEqual(requests, [{ identifier: "admin", password: "correct horse" }])
  })

  test(`${adapterName} returns 401 for failed token login`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        loginItemsAppUser: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/auth/token",
      body: { identifier: "missing-user", password: "wrong" },
    })

    assert.equal(response.status, 401)
    assert.equal(readError(response.body), "Invalid username, email, phone, or password.")
  })

  test(`${adapterName} revokes the presented token`, async (t) => {
    const revoked: string[] = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        revokeItemsAppToken: async ({ token }) => {
          revoked.push(token)
          return true
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "DELETE",
      path: "/api/auth/token",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { ok: true })
    assert.deepEqual(revoked, [sampleApiToken])
  })

  test(`${adapterName} rejects unauthenticated requests with 401`, async (t) => {
    const adapter = await createAdapter(createFakeItemsAppService())

    t.after(async () => {
      await adapter.close?.()
    })

    for (const request of [
      { method: "GET" as const, path: "/api/session" },
      { method: "GET" as const, path: "/api/items" },
      { method: "GET" as const, path: "/api/tags" },
      { method: "GET" as const, path: "/api/categories" },
      {
        method: "POST" as const,
        path: "/api/items/search",
        body: { query: "anything", limit: 5 },
      },
    ]) {
      const response = await adapter.request(request)
      assert.equal(response.status, 401, `${request.method} ${request.path}`)
      assert.equal(readError(response.body), "Authentication required.")
    }
  })

  test(`${adapterName} rejects invalid bearer tokens with 401`, async (t) => {
    const adapter = await createAdapter(createFakeItemsAppService())

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/items",
      headers: { Authorization: "Bearer not-a-real-token" },
    })

    assert.equal(response.status, 401)
    assert.equal(readError(response.body), "Authentication required.")
  })

  test(`${adapterName} ignores client-supplied userId and uses the authenticated user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        deleteItemForItemsApp: async (request) => {
          requests.push({ userId: request.userId })
          return { ok: true }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "DELETE",
      path: "/api/items",
      headers: authHeaders,
      body: { userId: 999999, itemId: 41 },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(requests, [{ userId: sampleUser.id }])
  })

  test(`${adapterName} returns the authenticated session user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        getItemsAppSession: async (request) => {
          requests.push(request)
          return { user: sampleUser }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/session",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { user: sampleUser })
    assert.deepEqual(requests, [{ userId: sampleUser.id }])
  })

  test(`${adapterName} returns 404 when a stored session user is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        getItemsAppSession: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/session",
      headers: authHeaders,
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "User not found.")
  })

  test(`${adapterName} updates user preferences via session patch`, async (t) => {
    const requests: Array<{
      userId: number
      preferences: { notesApp?: { resultsColumnWidth?: number } }
    }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        updateItemsAppUserPreferences: async (request) => {
          requests.push(request)
          return { user: { ...sampleUser, preferences: request.preferences } }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "PATCH",
      path: "/api/session",
      headers: authHeaders,
      body: {
        userId: 7,
        preferences: {
          notesApp: {
            resultsColumnWidth: 512,
          },
        },
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, {
      user: {
        ...sampleUser,
        preferences: {
          notesApp: {
            resultsColumnWidth: 512,
          },
        },
      },
    })
    assert.deepEqual(requests, [
      {
        userId: 7,
        preferences: {
          notesApp: {
            resultsColumnWidth: 512,
          },
        },
      },
    ])
  })

  test(`${adapterName} lists notes for the requested workspace`, async (t) => {
    const requests: Array<{ userId: number; workspaceId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        listItemsForItemsApp: async (request) => {
          requests.push(request)
          return { items: [sampleItem] }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "GET",
      path: "/api/items?workspaceId=3",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { items: [sampleItem] })
    assert.deepEqual(requests, [{ userId: 7, workspaceId: 3 }])
  })

  test(`${adapterName} lists tags for the requested workspace`, async (t) => {
    const requests: Array<{ userId: number; workspaceId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        listTagsForItemsApp: async (request) => {
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
      path: "/api/tags?workspaceId=3",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { tags: [sampleTag] })
    assert.deepEqual(requests, [{ userId: 7, workspaceId: 3 }])
  })

  test(`${adapterName} lists categories for the requested workspace`, async (t) => {
    const requests: Array<{ userId: number; workspaceId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        listCategoriesForItemsApp: async (request) => {
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
      path: "/api/categories?workspaceId=3",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { categories: [sampleCategory] })
    assert.deepEqual(requests, [{ userId: 7, workspaceId: 3 }])
  })

  test(`${adapterName} lists workspaces for the authenticated user`, async (t) => {
    const requests: Array<{ userId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        listWorkspacesForItemsApp: async (request) => {
          requests.push(request)
          return { workspaces: [sampleWorkspace] }
        },
      }),
    )
    t.after(async () => adapter.close?.())

    const response = await adapter.request({
      method: "GET",
      path: "/api/workspaces",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { workspaces: [sampleWorkspace] })
    assert.deepEqual(requests, [{ userId: sampleUser.id }])
  })

  test(`${adapterName} lists statuses for the requested workspace`, async (t) => {
    const requests: Array<{ userId: number; workspaceId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        listStatusesForItemsApp: async (request) => {
          requests.push(request)
          return { statuses: [sampleStatus] }
        },
      }),
    )
    t.after(async () => adapter.close?.())

    const response = await adapter.request({
      method: "GET",
      path: "/api/statuses?workspaceId=3",
      headers: authHeaders,
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { statuses: [sampleStatus] })
    assert.deepEqual(requests, [{ userId: sampleUser.id, workspaceId: 3 }])
  })

  test(`${adapterName} lowercases category labels before create and update`, async (t) => {
    const createRequests: Array<{ userId: number; workspaceId: number; label: string }> = []
    const updateRequests: Array<{
      userId: number
      workspaceId: number
      categoryId: number
      label: string
    }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createCategoryForItemsApp: async (request) => {
          createRequests.push(request)
          return { category: sampleCategory }
        },
        updateCategoryForItemsApp: async (request) => {
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
      headers: authHeaders,
      body: { userId: 7, workspaceId: 3, label: "  Work  " },
    })
    const updateResponse = await adapter.request({
      method: "PATCH",
      path: "/api/categories",
      headers: authHeaders,
      body: { userId: 7, workspaceId: 3, categoryId: 5, label: "  WORK  " },
    })

    assert.equal(createResponse.status, 201)
    assert.equal(updateResponse.status, 200)
    assert.deepEqual(createRequests, [{ userId: 7, workspaceId: 3, label: "work" }])
    assert.deepEqual(updateRequests, [{ userId: 7, workspaceId: 3, categoryId: 5, label: "work" }])
  })

  test(`${adapterName} rejects the reserved category name on create and rename before service writes`, async (t) => {
    let writes = 0
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createCategoryForItemsApp: async () => {
          writes += 1
          return { category: sampleCategory }
        },
        updateCategoryForItemsApp: async () => {
          writes += 1
          return { category: sampleCategory }
        },
      }),
    )
    t.after(async () => adapter.close?.())
    for (const method of ["POST", "PATCH"] as const) {
      const response = await adapter.request({
        method,
        path: "/api/categories",
        headers: authHeaders,
        body: { workspaceId: 3, categoryId: 5, label: "  UNCATEGORIZED  " },
      })
      assert.equal(response.status, 400)
      assert.match(
        String((response.body as { error: string }).error),
        /reserved for notes without a category/,
      )
    }
    assert.equal(writes, 0)
  })

  test(`${adapterName} deletes a category without deleting notes`, async (t) => {
    const requests: Array<{ userId: number; workspaceId: number; categoryId: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        deleteCategoryForItemsApp: async (request) => {
          requests.push(request)
          return { ok: true }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "DELETE",
      path: "/api/categories",
      headers: authHeaders,
      body: { userId: 7, workspaceId: 3, categoryId: 5 },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { ok: true })
    assert.deepEqual(requests, [{ userId: 7, workspaceId: 3, categoryId: 5 }])
  })

  test(`${adapterName} lowercases tag labels before create and update`, async (t) => {
    const createRequests: Array<{ userId: number; workspaceId: number; label: string }> = []
    const updateRequests: Array<{
      userId: number
      workspaceId: number
      tagId: number
      label: string
    }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createTagForItemsApp: async (request) => {
          createRequests.push(request)
          return { tag: sampleTag }
        },
        updateTagForItemsApp: async (request) => {
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
      headers: authHeaders,
      body: { userId: 7, workspaceId: 3, label: "  Verify The HTTP API Contract  " },
    })
    const updateResponse = await adapter.request({
      method: "PATCH",
      path: "/api/tags",
      headers: authHeaders,
      body: {
        userId: 7,
        workspaceId: 3,
        tagId: 12,
        label: "  VERIFY THE HTTP API CONTRACT  ",
      },
    })

    assert.equal(createResponse.status, 201)
    assert.equal(updateResponse.status, 200)
    assert.deepEqual(createRequests, [
      { userId: 7, workspaceId: 3, label: "verify the http api contract" },
    ])
    assert.deepEqual(updateRequests, [
      { userId: 7, workspaceId: 3, tagId: 12, label: "verify the http api contract" },
    ])
  })

  test(`${adapterName} creates notes with a 201 response`, async (t) => {
    const requests: Array<unknown> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createItemForItemsApp: async (request) => {
          requests.push(request)
          return { item: sampleItem }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/items",
      headers: authHeaders,
      body: {
        userId: 7,
        item: {
          workspaceId: 3,
          categoryIds: [5],
          statusId: null,
          tagIds: [12],
          description: "The Notes API routes should follow the shared contract.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    })

    assert.equal(response.status, 201)
    assert.deepEqual(response.body, { item: sampleItem })
    assert.deepEqual(requests, [
      {
        userId: 7,
        item: {
          workspaceId: 3,
          categoryIds: [5],
          statusId: null,
          tagIds: [12],
          description: "The Notes API routes should follow the shared contract.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    ])
  })

  test(`${adapterName} allows notes without due or reminder times`, async (t) => {
    const requests: Array<unknown> = []
    const itemWithoutDates = {
      ...sampleItem,
      timeDue: null,
      timeRemind: null,
    }
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createItemForItemsApp: async (request) => {
          requests.push(request)
          return { item: itemWithoutDates }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/items",
      headers: authHeaders,
      body: {
        userId: 7,
        item: {
          workspaceId: 3,
          categoryIds: [5],
          statusId: null,
          tagIds: [12],
          description: "No due or reminder dates selected.",
        },
      },
    })

    assert.equal(response.status, 201)
    assert.deepEqual(response.body, { item: itemWithoutDates })
    assert.deepEqual(requests, [
      {
        userId: 7,
        item: {
          workspaceId: 3,
          categoryIds: [5],
          statusId: null,
          tagIds: [12],
          description: "No due or reminder dates selected.",
          timeDue: null,
          timeRemind: null,
        },
      },
    ])
  })

  test(`${adapterName} returns 404 when an update target is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        updateItemForItemsApp: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "PATCH",
      path: "/api/items",
      headers: authHeaders,
      body: {
        userId: 7,
        itemId: 999,
        item: {
          workspaceId: 3,
          categoryIds: [5],
          statusId: null,
          tagIds: [12],
          description: "The Notes API routes should follow the shared contract.",
          timeDue: "2026-03-18T16:00:00.000Z",
          timeRemind: "2026-03-18T15:30:00.000Z",
        },
      },
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "Item not found.")
  })

  test(`${adapterName} returns 404 when a delete target is missing`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        deleteItemForItemsApp: async () => null,
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "DELETE",
      path: "/api/items",
      headers: authHeaders,
      body: {
        userId: 7,
        itemId: 999,
      },
    })

    assert.equal(response.status, 404)
    assert.equal(readError(response.body), "Item not found.")
  })

  test(`${adapterName} maps search failures through the shared status helper`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        getItemsAppErrorStatus: () => 502,
        searchItemsForItemsApp: async () => {
          throw new Error("Embedding provider failed.")
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/items/search",
      headers: authHeaders,
      body: {
        userId: 7,
        workspaceId: 3,
        query: "adapter parity",
        limit: 12,
      },
    })

    assert.equal(response.status, 502)
    assert.equal(readError(response.body), "Embedding provider failed.")
  })

  test(`${adapterName} lowercases search queries`, async (t) => {
    const requests: Array<{
      userId: number
      workspaceId: number
      query: string
      limit: number
    }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        searchItemsForItemsApp: async (request) => {
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
      path: "/api/items/search",
      headers: authHeaders,
      body: {
        userId: 7,
        workspaceId: 3,
        query: "  Adapter Parity  ",
        limit: 12,
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { results: [sampleSearchResult] })
    assert.deepEqual(requests, [{ userId: 7, workspaceId: 3, query: "adapter parity", limit: 12 }])
  })

  test(`${adapterName} runs embedding maintenance in missing mode`, async (t) => {
    const requests: Array<{ userId: number; mode: string; limit: number }> = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        maintainItemEmbeddingsForItemsApp: async (request) => {
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
      path: "/api/items/maintenance/embeddings",
      headers: authHeaders,
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
    const adapter = await createAdapter(createFakeItemsAppService())

    t.after(async () => {
      await adapter.close?.()
    })

    const response = await adapter.request({
      method: "POST",
      path: "/api/items/maintenance/embeddings",
      headers: authHeaders,
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
      createFakeItemsAppService({
        maintainItemEmbeddingsForItemsApp: async (request) => {
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
      path: "/api/items/maintenance/embeddings",
      headers: authHeaders,
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
