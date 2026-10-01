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

function harness({
  initial = "in_progress",
  changeHead = false,
  changeMerge = false,
  apiFailure = false,
  mergeAvailable = true,
  checksOn = ["head", "merge", "new-head", "new-merge"],
} = {}) {
  let tick = 0
  const writes = [],
    states = new Map()
  const pr = () => ({
    number: 1,
    state: "open",
    base: { ref: "main" },
    head: { sha: changeHead && tick ? "new-head" : "head" },
    merge_commit_sha: mergeAvailable
      ? (changeHead || changeMerge) && tick
        ? "new-merge"
        : "merge"
      : null,
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
        return checksOn.includes(args.ref)
          ? [{ name: "CI", status: tick ? "completed" : initial, conclusion: "failure" }]
          : []
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

test("publishes a single durable head gate after checks finish and settle", async () => {
  const { options, writes } = harness()
  await observe(options)
  assert.equal(writes[0].state, "pending")
  assert.deepEqual([...new Set(writes.map((s) => s.sha))], ["head"])
  assert.deepEqual(
    writes.filter((s) => s.state === "success").map((s) => s.sha),
    ["head"],
  )
})
test("reports one head gate when GitHub has no test merge revision", async () => {
  const { options, writes } = harness({ mergeAvailable: false })
  await observe(options)
  assert.deepEqual([...new Set(writes.map((s) => s.sha))], ["head"])
  assert.equal(writes.at(-1).state, "success")
})
for (const ref of ["head", "merge"]) {
  test(`unfinished checks only on ${ref} still block the single head gate`, async () => {
    const { options, writes } = harness({ checksOn: [ref] })
    // Observe again while this revision's check is still running, then stop.
    options.sleep = async () => {
      throw new Error("stop while check is running")
    }
    await assert.rejects(observe(options), /stop while check is running/)
    assert.deepEqual([...new Set(writes.map((s) => s.sha))], ["head"])
    assert.equal(
      writes.every((s) => s.state === "pending"),
      true,
    )
  })
}
test("new commits must acquire their own completion gate", async () => {
  const { options, writes } = harness({ changeHead: true })
  await observe(options)
  assert.equal(
    writes.some((s) => s.sha === "head" && s.state === "success"),
    false,
  )
  assert.deepEqual(
    writes.filter((s) => s.state === "success").map((s) => s.sha),
    ["new-head"],
  )
})
test("regenerated test merge revisions preserve one durable head gate", async () => {
  const { options, writes } = harness({ changeMerge: true })
  await observe(options)
  assert.deepEqual([...new Set(writes.map((s) => s.sha))], ["head"])
  assert.equal(writes.at(-1).state, "success")
})
test("queued policy test workflows block before their jobs register", () => {
  assert.equal(
    completion({
      ...empty,
      runs: [
        {
          name: "PR completion policy tests",
          path: ".github/workflows/pr-check-completion-tests.yml",
          status: "queued",
        },
      ],
    }).state,
    "pending",
  )
})
test("PR code executes only in the read-only policy workflow", () => {
  const { readFileSync } = require("node:fs")
  const { resolve } = require("node:path")
  const observer = readFileSync(resolve(__dirname, "../workflows/pr-check-completion.yml"), "utf8")
  const tests = readFileSync(
    resolve(__dirname, "../workflows/pr-check-completion-tests.yml"),
    "utf8",
  )
  assert.doesNotMatch(observer, /^  pull_request:$/m)
  assert.match(observer, /^  pull_request_target:$/m)
  assert.match(observer, /bootstrap \|\| context.payload.repository.default_branch/)
  assert.doesNotMatch(observer, /github\.sha|pull_request\.head|pull_request\.base/)
  assert.match(tests, /^  pull_request:$/m)
  assert.doesNotMatch(tests, /: write/)
  assert.doesNotMatch(tests, /secrets\./)
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
