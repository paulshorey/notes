const GATE = "PR checks finished"
const OBSERVER = "Observe PR check completion"
const WORKFLOW = ".github/workflows/pr-check-completion.yml"
const BRANCHES = new Set(["main", "prod"])

function completion({ checks, statuses, runs }) {
  const pending = checks
    .filter((check) => !(check.name === OBSERVER && check.app?.slug === "github-actions"))
    .filter((check) => check.status !== "completed")
    .map((check) => check.name)
  // Status lists are newest-first; an old pending result must not hide the
  // latest success/failure, and a new pending result must invalidate success.
  const latest = new Map()
  for (const status of statuses) {
    const key = `${status.ref || ""}:${status.context}`
    if (!latest.has(key)) latest.set(key, status)
  }
  for (const status of latest.values()) {
    if (status.context !== GATE && status.state === "pending") pending.push(status.context)
  }
  for (const run of runs) {
    if (run.path?.split("@")[0] !== WORKFLOW && run.status !== "completed") {
      pending.push(`workflow: ${run.name}`)
    }
  }
  return { state: pending.length ? "pending" : "success", pending: [...new Set(pending)] }
}

// Reporting on the test merge commit makes it GitHub's merge-evaluation
// revision. Fall back to the head when no test merge commit is available.
function gateRevision(pr) {
  return pr.merge_commit_sha || pr.head.sha
}

async function snapshot(github, repo, pr) {
  const refs = [...new Set([pr.head.sha, pr.merge_commit_sha].filter(Boolean))]
  const checks = [],
    statuses = [],
    runs = []
  for (const ref of refs) {
    checks.push(
      ...(await github.paginate(github.rest.checks.listForRef, {
        ...repo,
        ref,
        per_page: 100,
        filter: "latest",
      })),
    )
    statuses.push(
      ...(
        await github.paginate(github.rest.repos.listCommitStatusesForRef, {
          ...repo,
          ref,
          per_page: 100,
        })
      ).map((status) => ({ ...status, ref })),
    )
    runs.push(
      ...(await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
        ...repo,
        head_sha: ref,
        per_page: 100,
      })),
    )
  }
  return { refs, result: completion({ checks, statuses, runs }), statuses }
}

async function observe({
  github,
  context,
  core,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const repo = context.repo
  const targetUrl = `${context.serverUrl || "https://github.com"}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`
  const deadline = now() + 85 * 60_000
  // Two identical completed observations avoid releasing the gate during the
  // initial registration of asynchronous external checks and queued workflows.
  const settled = new Map()
  const initialized = new Set()
  for (;;) {
    const pulls = await github.paginate(github.rest.pulls.list, {
      ...repo,
      state: "open",
      per_page: 100,
    })
    let waiting = false
    for (const pull of pulls.filter((pr) => BRANCHES.has(pr.base.ref))) {
      const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: pull.number })
      if (pr.state !== "open") continue
      const sha = gateRevision(pr)
      const identity = `${pr.number}:${pr.head.sha}:${pr.merge_commit_sha}`
      if (!initialized.has(identity)) {
        // Reset a previous successful gate before reading provider APIs. If a
        // provider/API fails, this observation must leave the PR blocked.
        await github.rest.repos.createCommitStatus({
          ...repo,
          sha,
          context: GATE,
          state: "pending",
          target_url: targetUrl,
          description: "Checking whether all PR checks have finished.",
        })
        initialized.add(identity)
      }
      const { refs, result } = await snapshot(github, repo, pr)
      const signature = JSON.stringify({ refs, pending: result.pending })
      const ready = result.state === "success" && settled.get(pr.number) === signature
      settled.set(pr.number, result.state === "success" ? signature : null)
      const state = ready ? "success" : "pending"
      waiting ||= state === "pending"
      // Do not publish a result against an obsolete PR head or merge revision.
      const { data: current } = await github.rest.pulls.get({ ...repo, pull_number: pr.number })
      if (
        current.state !== "open" ||
        current.head.sha !== pr.head.sha ||
        current.merge_commit_sha !== pr.merge_commit_sha
      ) {
        settled.delete(pr.number)
        waiting = true
        continue
      }
      const existing = await github.paginate(github.rest.repos.listCommitStatusesForRef, {
        ...repo,
        ref: sha,
        per_page: 100,
      })
      if (existing.find((status) => status.context === GATE)?.state !== state) {
        await github.rest.repos.createCommitStatus({
          ...repo,
          sha,
          context: GATE,
          state,
          target_url: targetUrl,
          description: ready
            ? "All registered checks finished. Review their results before merging."
            : result.pending.length
              ? `Waiting for ${result.pending.length} running or queued check(s).`
              : "Waiting for check registration to settle.",
        })
      }
      core.info(
        `PR #${pr.number}: ${state}${result.pending.length ? ` (${result.pending.join(", ")})` : ""}`,
      )
    }
    if (!waiting) return
    if (now() >= deadline) {
      // A stuck provider/API must never open the gate. A later event or manual
      // workflow dispatch can resume observation without changing CI outcomes.
      core.warning(
        "Observation timed out; unfinished PRs remain blocked by their pending completion status.",
      )
      return
    }
    await sleep(60_000)
  }
}

module.exports = { GATE, OBSERVER, WORKFLOW, completion, snapshot, observe }
