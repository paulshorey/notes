import assert from "node:assert/strict"
import { test } from "node:test"
import {
  describeItemsAppError,
  EmbeddingRequestError,
  ItemChangedError,
  type ItemsAppService,
} from "../services/items-app"

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
  uid: "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10",
  workspaceId: 3,
  category: { id: 5, label: "work" },
  subcategory: { id: 6, label: "api" },
  status: null,
  tags: [{ id: 12, label: "verify the http api contract" }],
  description: "The Notes API routes should follow the shared contract.",
  timeStart: null,
  timeEnd: null,
  entryDate: null,
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

const sampleSubcategory = {
  id: 6,
  categoryId: 5,
  label: "api",
  itemCount: 1,
  lastUsedAt: sampleItem.timeModified,
}

const sampleCategory = {
  id: 5,
  workspaceId: 3,
  label: "work",
  itemCount: 1,
  lastUsedAt: sampleItem.timeModified,
  subcategories: [sampleSubcategory],
}

const sampleWorkspace = {
  id: 3,
  uid: "7d2a9f04-3b1c-4e8d-a6f5-9c0e1b2d3a44",
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

export const sampleTrashedItem = {
  id: 12,
  workspaceLabel: "personal",
  timeDeleted: "2027-01-03T03:04:05.000Z",
  description: "An old note",
  category: "work",
  subcategory: null,
  status: null,
  tags: ["urgent"],
  timeStart: null,
  timeEnd: null,
  entryDate: null,
  timeDue: null,
  timeRemind: null,
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
  previewItemGroupForItemsApp: async () => ({
    snapshot: "a".repeat(64),
    label: "work",
    itemIds: [41],
    itemCount: 1,
    textItemCount: 1,
    subcategoryCount: 0,
  }),
  executeItemGroupActionForItemsApp: async () => ({
    items: [],
    deletedItemIds: [],
    category: null,
    removedCategoryId: null,
    removedSubcategoryId: null,
  }),
  exportUserBackup: async () => {
    throw new Error("Backup not configured in this test.")
  },
  restoreUserBackup: async () => ({ itemsImported: 0, itemsSkipped: 0 }),
  getItemsAppErrorStatus: () => 400,
  describeItemsAppError,
  embedItemForItemsApp: async () => false,
  getItemsAppSession: async () => ({ user: sampleUser }),
  findItemWorkspaceForItemsApp: async () => null,
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
  listTrashForItemsApp: async () => ({
    items: [sampleTrashedItem],
    retentionDays: 30,
    hasMore: false,
    nextCursor: null,
  }),
  restoreTrashedItemForItemsApp: async () => ({ item: sampleItem }),
  combineJournalDayForItemsApp: async () => ({ item: sampleItem }),
  purgeTrashForItemsApp: async () => ({ ok: true, purged: 1 }),
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
    const createRequests: Array<{
      userId: number
      workspaceId: number
      label: string
      categoryId?: number
    }> = []
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

    // A parent category turns the same request into a subcategory create.
    const subcategoryResponse = await adapter.request({
      method: "POST",
      path: "/api/categories",
      headers: authHeaders,
      body: { userId: 7, workspaceId: 3, categoryId: "5", label: "  API  " },
    })

    assert.equal(createResponse.status, 201)
    assert.equal(updateResponse.status, 200)
    assert.equal(subcategoryResponse.status, 201)
    assert.deepEqual(createRequests, [
      { userId: 7, workspaceId: 3, label: "work" },
      { userId: 7, workspaceId: 3, label: "api", categoryId: 5 },
    ])
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
          uid: " 0B6F1C1E-8F0A-4C56-9D3E-2A7B5C9E4F10 ",
          workspaceId: 3,
          categoryId: 5,
          subcategoryId: 6,
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
          uid: "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10",
          workspaceId: 3,
          categoryId: 5,
          subcategoryId: 6,
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
          categoryId: 5,
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
          uid: null,
          workspaceId: 3,
          categoryId: 5,
          subcategoryId: null,
          statusId: null,
          tagIds: [12],
          description: "No due or reminder dates selected.",
          timeDue: null,
          timeRemind: null,
        },
      },
    ])
  })

  test(`${adapterName} answers 200 when a create names an item that already exists`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createItemForItemsApp: async () => ({ item: sampleItem, created: false }),
      }),
    )
    t.after(async () => adapter.close?.())

    const response = await adapter.request({
      method: "POST",
      path: "/api/items",
      headers: authHeaders,
      body: {
        userId: 7,
        item: { uid: sampleItem.uid, workspaceId: 3, tagIds: [], description: "Sent again." },
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { item: sampleItem })
  })

  test(`${adapterName} refuses a create whose uid is not a UUID`, async (t) => {
    let writes = 0
    const adapter = await createAdapter(
      createFakeItemsAppService({
        createItemForItemsApp: async () => {
          writes += 1
          return { item: sampleItem }
        },
      }),
    )
    t.after(async () => adapter.close?.())

    const response = await adapter.request({
      method: "POST",
      path: "/api/items",
      headers: authHeaders,
      body: {
        userId: 7,
        item: { uid: "41", workspaceId: 3, tagIds: [], description: "Not a public id." },
      },
    })
    assert.equal(response.status, 400)
    assert.deepEqual(response.body, { error: "uid must be a UUID.", code: "invalid_request" })
    assert.equal(writes, 0)
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
          categoryId: 5,
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

  test(`${adapterName} reports a failed search without the provider's detail`, async (t) => {
    const adapter = await createAdapter(
      createFakeItemsAppService({
        searchItemsForItemsApp: async () => {
          throw new EmbeddingRequestError("provider detail", 429)
        },
      }),
    )
    t.after(async () => adapter.close?.())
    const response = await adapter.request({
      method: "POST",
      path: "/api/items/search",
      headers: authHeaders,
      body: { workspaceId: 3, query: "adapter parity", limit: 12 },
    })
    assert.equal(response.status, 503)
    assert.deepEqual(response.body, {
      error: "Search is temporarily unavailable.",
      code: "search_unavailable",
    })
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

  test(`${adapterName} lists, restores, and empties the trash`, async (t) => {
    const requests: unknown[] = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        listTrashForItemsApp: async (request) => {
          requests.push(request)
          return { items: [sampleTrashedItem], retentionDays: 30, hasMore: false, nextCursor: null }
        },
        restoreTrashedItemForItemsApp: async (request) => {
          requests.push(request)
          return request.trashId === 12 ? { item: sampleItem } : null
        },
        purgeTrashForItemsApp: async (request) => {
          requests.push(request)
          return { ok: true, purged: 2 }
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const listed = await adapter.request({
      method: "GET",
      path: "/api/items/trash",
      headers: authHeaders,
    })
    assert.equal(listed.status, 200)
    assert.deepEqual(listed.body, {
      items: [sampleTrashedItem],
      retentionDays: 30,
      hasMore: false,
      nextCursor: null,
    })

    const restored = await adapter.request({
      method: "POST",
      path: "/api/items/trash",
      headers: authHeaders,
      body: { userId: 999999, trashId: 12 },
    })
    assert.equal(restored.status, 200)
    assert.deepEqual(restored.body, { item: sampleItem })

    const gone = await adapter.request({
      method: "POST",
      path: "/api/items/trash",
      headers: authHeaders,
      body: { trashId: 13 },
    })
    assert.equal(gone.status, 404)
    assert.equal(readError(gone.body), "This item is no longer in the trash.")

    const emptied = await adapter.request({
      method: "DELETE",
      path: "/api/items/trash",
      headers: authHeaders,
      body: {},
    })
    assert.equal(emptied.status, 200)
    assert.deepEqual(emptied.body, { ok: true, purged: 2 })

    assert.deepEqual(requests, [
      { userId: sampleUser.id },
      { userId: sampleUser.id, trashId: 12 },
      { userId: sampleUser.id, trashId: 13 },
      { userId: sampleUser.id },
    ])

    const unauthenticated = await adapter.request({
      method: "GET",
      path: "/api/items/trash",
    })
    assert.equal(unauthenticated.status, 401)
  })

  test(`${adapterName} answers a stale update with 409 and the stored item`, async (t) => {
    const requests: unknown[] = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        updateItemForItemsApp: async (request) => {
          requests.push(request.expectedTimeModified)
          throw new ItemChangedError(sampleItem)
        },
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
        itemId: sampleItem.id,
        item: { workspaceId: 3, description: "mine" },
        expectedTimeModified: "2027-01-01T00:00:00Z",
      },
    })
    assert.equal(response.status, 409)
    assert.deepEqual(response.body, {
      error: "The saved item changed since this edit began.",
      code: "item_changed",
      item: sampleItem,
    })
    assert.deepEqual(requests, ["2027-01-01T00:00:00.000Z"])
  })

  test(`${adapterName} combines an item into the journal day it names`, async (t) => {
    const requests: unknown[] = []
    const adapter = await createAdapter(
      createFakeItemsAppService({
        combineJournalDayForItemsApp: async (request) => {
          requests.push(request)
          return request.itemId === 41 ? { item: sampleItem } : null
        },
      }),
    )

    t.after(async () => {
      await adapter.close?.()
    })

    const combined = await adapter.request({
      method: "POST",
      path: "/api/items/journal",
      headers: authHeaders,
      body: { userId: 999999, itemId: 41, entryDate: "2026-11-25" },
    })
    assert.equal(combined.status, 200)
    assert.deepEqual(combined.body, { item: sampleItem })
    assert.deepEqual(requests, [{ userId: sampleUser.id, itemId: 41, entryDate: "2026-11-25" }])

    const missing = await adapter.request({
      method: "POST",
      path: "/api/items/journal",
      headers: authHeaders,
      body: { itemId: 42, entryDate: "2026-11-25" },
    })
    assert.equal(missing.status, 404)

    const invalid = await adapter.request({
      method: "POST",
      path: "/api/items/journal",
      headers: authHeaders,
      body: { itemId: 41, entryDate: "tomorrow" },
    })
    assert.equal(invalid.status, 400)

    const unauthenticated = await adapter.request({
      method: "POST",
      path: "/api/items/journal",
      body: { itemId: 41, entryDate: "2026-11-25" },
    })
    assert.equal(unauthenticated.status, 401)
  })
}
