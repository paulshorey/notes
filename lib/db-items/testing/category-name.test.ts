import assert from "node:assert/strict"
import { test } from "node:test"
import { getCategoryNameError, RESERVED_CATEGORY_NAME_ERROR } from "../contracts/category-name"
import {
  createCategoryForItemsApp,
  parseCreateCategoryRequest,
  parseUpdateCategoryRequest,
  parseCreateTagRequest,
  parseCreateWorkspaceRequest,
  updateCategoryForItemsApp,
} from "../services/items-app"

test("the exact normalized category name uncategorized is reserved", async () => {
  for (const label of ["uncategorized", "Uncategorized", "  UNCATEGORIZED  "]) {
    assert.equal(getCategoryNameError(label), RESERVED_CATEGORY_NAME_ERROR)
    const request = { userId: 1, workspaceId: 1, categoryId: 1, label }
    assert.throws(() => parseCreateCategoryRequest(request), {
      message: RESERVED_CATEGORY_NAME_ERROR,
    })
    assert.throws(() => parseUpdateCategoryRequest(request), {
      message: RESERVED_CATEGORY_NAME_ERROR,
    })
    // Service callers bypassing request parsing must fail before embeddings or DB access.
    await assert.rejects(createCategoryForItemsApp(request), {
      message: RESERVED_CATEGORY_NAME_ERROR,
    })
    await assert.rejects(updateCategoryForItemsApp(request), {
      message: RESERVED_CATEGORY_NAME_ERROR,
    })
  }
  assert.equal(getCategoryNameError("uncategorized ideas"), null)
  assert.equal(getCategoryNameError("work"), null)
  assert.equal(
    parseCreateTagRequest({ userId: 1, workspaceId: 1, label: "uncategorized" }).label,
    "uncategorized",
  )
  assert.equal(
    parseCreateWorkspaceRequest({ userId: 1, label: "uncategorized" }).label,
    "uncategorized",
  )
})
