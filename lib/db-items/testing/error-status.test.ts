import assert from "node:assert/strict"
import test from "node:test"
import { getItemsAppErrorStatus, parsePositiveInteger } from "../services/items-app"

test("database connection failures are reported as service unavailable", () => {
  assert.equal(
    getItemsAppErrorStatus(new Error("Connection terminated due to connection timeout")),
    503,
  )

  const connectionError = Object.assign(new Error("connection failure"), { code: "08006" })
  assert.equal(getItemsAppErrorStatus(connectionError), 503)

  for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]) {
    assert.equal(getItemsAppErrorStatus(Object.assign(new Error(`connect ${code}`), { code })), 503)
  }

  assert.equal(getItemsAppErrorStatus(new Error("timeout exceeded when trying to connect")), 503)
})

test("ordinary request validation failures remain bad requests", () => {
  assert.throws(
    () => parsePositiveInteger("x", "workspaceId"),
    (error: unknown) => getItemsAppErrorStatus(error) === 400,
  )
  // An error the service did not raise on purpose is the server's fault.
  assert.equal(getItemsAppErrorStatus(new Error("something broke")), 500)
})
