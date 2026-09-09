import assert from "node:assert/strict"
import test from "node:test"
import { getNotesAppErrorStatus } from "../services/notes-app"

test("database connection failures are reported as service unavailable", () => {
  assert.equal(
    getNotesAppErrorStatus(new Error("Connection terminated due to connection timeout")),
    503,
  )

  const connectionError = Object.assign(new Error("connection failure"), { code: "08006" })
  assert.equal(getNotesAppErrorStatus(connectionError), 503)
})

test("ordinary request validation failures remain bad requests", () => {
  assert.equal(getNotesAppErrorStatus(new Error("workspaceId must be an integer")), 400)
})
