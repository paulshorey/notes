const assert = require("node:assert/strict")
const { test } = require("node:test")
const {
  completion,
  observe,
  GATE,
  OBSERVER,
  WORKFLOW,
} = require("../scripts/pr-check-completion.cjs")
const empty = { checks: [], statuses: [], runs: [] }

test("failed, cancelled, timed-out, skipped, and neutral checks are complete", () => {
  const checks = [
    "failure",
    "cancelled",
    "timed_out",
    "skipped",
    "neutral",
    "success",
    "action_required",
  ].map((conclusion) => ({ name: conclusion, status: "completed", conclusion }))
  assert.equal(completion({ ...empty, checks }).state, "success")
})
for (const status of ["queued", "in_progress", "waiting", "pending"]) {
  test(`${status} check prevents merging`, () => {
    assert.deepEqual(completion({ ...empty, checks: [{ name: "CI", status }] }), {
      state: "pending",
      pending: ["CI"],
    })
  })
}
test("Railway failure finishes; a newer pending deployment resets completion", () => {
  const failed = { context: "Railway", state: "failure" }
  assert.equal(
    completion({ ...empty, statuses: [failed, { ...failed, state: "pending" }] }).state,
    "success",
  )
  assert.equal(
    completion({ ...empty, statuses: [{ ...failed, state: "pending" }, failed] }).state,
    "pending",
  )
})
test("head success cannot hide a pending test-merge status with the same context", () => {
  const statuses = [
    { ref: "head", context: "CI", state: "success" },
    { ref: "merge", context: "CI", state: "pending" },
  ]
  assert.equal(completion({ ...empty, statuses }).state, "pending")
})
test("the observer and its own status never wait for themselves", () => {
  assert.equal(
    completion({
      checks: [{ name: OBSERVER, status: "in_progress", app: { slug: "github-actions" } }],
      statuses: [{ context: GATE, state: "pending" }],
      runs: [{ path: WORKFLOW, status: "in_progress" }],
    }).state,
    "success",
  )
})
test("a third party cannot be ignored merely by using the observer name", () => {
  assert.equal(
    completion({
      ...empty,
      checks: [{ name: OBSERVER, status: "queued", app: { slug: "cursor" } }],
    }).state,
    "pending",
  )
})
test("queued workflows block completion before their jobs register", () => {
  assert.equal(
    completion({
      ...empty,
      runs: [{ name: "CI", path: ".github/workflows/ci.yml", status: "queued" }],
    }).state,
    "pending",
  )
})

function harness({ initial = "in_progress", changeHead = false, apiFailure = false } = {}) {
  let tick = 0
  const writes = [],
    states = new Map()
  const pr = () => ({
    number: 1,
    state: "open",
    base: { ref: "main" },
    head: { sha: changeHead && tick ? "new-head" : "head" },
    merge_commit_sha: changeHead && tick ? "new-merge" : "merge",
  })
  const rest = {
    pulls: { list: "pulls", get: async () => ({ data: pr() }) },
    checks: { listForRef: "checks" },
    actions: { listWorkflowRunsForRepo: "runs" },
    repos: {
      listCommitStatusesForRef: "statuses",
      createCommitStatus: async (status) => {
        writes.push(status)
        states.set(status.sha, status)
      },
    },
  }
  const github = {
    rest,
    paginate: async (route, args) => {
      if (route === "pulls") return [pr()]
      if (route === "checks") {
        if (apiFailure) throw new Error("provider API unavailable")
        return [{ name: "CI", status: tick ? "completed" : initial, conclusion: "failure" }]
      }
      if (route === "statuses") return states.has(args.ref) ? [states.get(args.ref)] : []
      return []
    },
  }
  return {
    writes,
    options: {
      github,
      context: { repo: { owner: "test", repo: "notes" }, runId: 1 },
      core: { info() {}, warning() {} },
      now: () => tick * 60_000,
      sleep: async () => {
        if (++tick > 4) throw new Error("did not settle")
      },
    },
  }
}

test("publishes pending until failures are complete and settled, then success for both revisions", async () => {
  const { options, writes } = harness()
  await observe(options)
  assert.equal(writes[0].state, "pending")
  assert.deepEqual(
    writes.filter((s) => s.state === "success").map((s) => s.sha),
    ["head", "merge"],
  )
})
test("new commits must acquire their own completion gate", async () => {
  const { options, writes } = harness({ changeHead: true })
  await observe(options)
  assert.equal(
    writes.some((s) => s.sha === "head" && s.state === "success"),
    false,
  )
  assert.deepEqual(
    writes.filter((s) => s.state === "success").map((s) => s.sha),
    ["new-head", "new-merge"],
  )
})
test("provider API errors leave a pending gate instead of permitting a merge", async () => {
  const { options, writes } = harness({ apiFailure: true })
  await assert.rejects(observe(options), /provider API unavailable/)
  assert.ok(writes.length > 0)
  assert.equal(
    writes.every((s) => s.state === "pending"),
    true,
  )
})
test("a stuck check times out without publishing success", async () => {
  const { options, writes } = harness()
  options.now = (() => {
    let calls = 0
    return () => (calls++ ? 86 * 60_000 : 0)
  })()
  await observe(options)
  assert.equal(
    writes.some((s) => s.state === "success"),
    false,
  )
})
