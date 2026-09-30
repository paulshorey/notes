# Wait for PR checks to finish

PRs into `main` or `prod` require the **PR checks finished** commit status. This
status means all registered checks finished; it does **not** mean their results
passed. The developer reviews failures and decides whether to merge. Individual
CI, security, review, and Railway results retain their original outcomes.

The GitHub repository ruleset is recorded in
`.github/pr-check-completion-ruleset.json`. Only the aggregate status is required,
with GitHub Actions (integration ID 15368) as its source and no bypass actors.
Branches do not have to be updated with the base before merging. Like any native
required status rule, this also prevents direct pushes without the required status.

## How the workflow works

`.github/workflows/pr-check-completion.yml` runs for every PR into either target
branch, without path filters. It checks both the current head and the test merge
commit, collecting paginated check runs, latest commit statuses per context, and
workflow runs. Queued, waiting, and running checks/workflows and pending statuses
keep the gate pending. Failure, error, cancellation, timeout, skipped, neutral,
and successful results all count as finished.

The observer is excluded from its own assessment to avoid a deadlock. Its policy
test job is assessed like any other check. Two completed observations one minute
apart let asynchronous providers register their checks before the gate opens.
Successful observations are written to both PR revisions; changing either revision
starts a fresh assessment. It re-reads the PR before releasing a gate to avoid
publishing a result based on an obsolete head.

The observer checks all open PRs into the protected branches, including PRs opened
before the policy was installed. It polls every minute while any are unfinished.
API failures or an 85-minute observation deadline leave unfinished gates pending.
A later event or **Run workflow** resumes observation. The workflow never executes
PR app code or changes individual check results, deployments, or database contents.

Same-repository PRs can bootstrap the workflow from their merge revision. Fork PRs
use `pull_request_target` and trusted base code, with no fork checkout. Other event
handlers use the default branch. The observer token has only read permissions plus
`statuses: write`; it has no repository-content, settings, or PR write permission.

## Reruns and GitHub event limitations

Commit status updates (including Railway), external `check_run` events, and the
start/completion of the repository's Actions workflows resume observation and reset
an earlier successful gate while work is pending. When adding a CI workflow, add
its workflow **name** to the completion workflow's `workflow_run.workflows` list.
GitHub does not allow an Actions-generated `check_run` event to recursively trigger
another workflow, so `workflow_run` covers those CI runs instead.

GitHub can also suppress `check_run` events when a check suite's head SHA is
associated with Actions. Consequently, after the initial observer has finished,
an external check rerun that emits no usable event cannot reliably reopen the
completion gate. **Rerun the completion workflow before rerunning such an external
check**, or use **Run workflow** to reassess its current state. A check registered
later than the settling window is likewise only reflected once an observer runs.
There is normal event/runner/polling latency; this workflow is not an atomic
GitHub rule requiring every arbitrary third-party check to be terminal. Strict,
instant enforcement for such providers would require a separate webhook/GitHub
App integration. Do not treat the green completion status as a quality approval.

## Installation and recovery

Merge this workflow into `main` for repository-wide event handlers. Promote the
workflow and its script to `prod` as well so fork PRs into `prod` can use trusted
base code. The initial same-repository PR workflow can report completion before
its installation on the default branch.

The checked-in ruleset document is desired configuration, not automatically
applied by a source push. After observing the status from GitHub Actions, an admin
can create the rule using:

```sh
gh api --method POST repos/paulshorey/notes/rulesets \
  --input .github/pr-check-completion-ruleset.json
```

Inspect existing rulesets first; update a matching ruleset rather than creating
a duplicate. A stuck external check must finish or be cancelled, or the gate must
remain pending. Investigate provider/API errors and rerun the observer. Avoid
manually setting a successful aggregate without inspecting the current checks.

Policy regression tests need only Node.js:

```sh
node --test .github/test/pr-check-completion.test.cjs
```

Official documentation:

- [Required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
- [Workflow events and recursion limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Head and test merge status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
