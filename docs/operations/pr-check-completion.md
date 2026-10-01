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
The gate is published only to the durable PR head commit. GitHub can regenerate
the temporary test merge commit during a merge attempt, even with identical
parents. Reporting only on that temporary commit can leave the required context
missing and block an otherwise complete PR. Both revisions are still inspected;
changing either starts a fresh assessment. The observer re-reads the PR before
releasing a gate to avoid publishing a result based on obsolete revisions.
Historical statuses from earlier implementations remain on old commits; new
heads receive a single aggregate report.

The observer checks all open PRs into the protected branches, including PRs opened
before the policy was installed. It polls every minute while any are unfinished.
API failures or an 85-minute observation deadline leave unfinished gates pending.
A later event or **Run workflow** resumes observation. The workflow never executes
PR app code or changes individual check results, deployments, or database contents.

The status-writing workflow has no `pull_request` trigger. For both same-repository
and fork PRs, `pull_request_target` runs trusted policy code. Every automatic
observer checks out the repository's default branch explicitly, including
`push`, status, check, and workflow events. PR code executes only in the separate
`pr-check-completion-tests.yml` workflow, which has read-only permissions. Its
queued workflow and test job are assessed like other checks. The privileged
observer never loads PR artifacts, caches, dependencies, or interpolated PR shell
input. Its token has only read permissions plus `statuses: write`.

This removes the automatic execution of PR-controlled policy with a status-writing
token identified by the security review. GitHub Actions integration pinning
identifies an app, not a particular workflow: a repository writer who can create
arbitrary write-token workflows can still forge the same context using another
workflow. This is a workflow gate for trusted collaborators, not a security
boundary against malicious repository writers. Hard enforcement against such
writers requires an independently controlled GitHub App or equivalent policy.

## Reruns and GitHub event limitations

Pushes to `main`/`prod`, commit status updates (including Railway), external
`check_run` events, and the start/completion of the repository's Actions workflows
resume observation and reset an earlier successful gate while work is pending. When adding a CI workflow, add
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

Merge the observer, tests, and script into `main` for repository-wide event
handlers. The observer uses trusted default-branch code even for PRs into `prod`;
the normal release flow can promote the policy files to production without a
separate policy-only PR.

Before the first installation, the observer is absent from `main`. An administrator
can manually dispatch the reviewed policy branch with an explicitly reviewed full
commit SHA as `bootstrap_policy_sha`. This is a deliberate first-installation
operation, not an automatic PR checkout. Verify the workflow and script at that
immutable SHA before dispatching it. Once installed, leave the input empty so the
observer always uses `main`:

```sh
gh workflow run pr-check-completion.yml --ref <reviewed-policy-branch> \
  -f bootstrap_policy_sha=<reviewed-40-character-commit-sha>
```

No rule bypass or successful status should be fabricated to bootstrap installation.
The manually dispatched observer still checks all current work and waits for it
to finish before publishing the aggregate.

The live repository ruleset is [Wait for PR check completion](https://github.com/paulshorey/notes/rules/24278400) (ID `24278400`). It targets both `main` and `prod`. The checked-in ruleset document is desired configuration, not automatically
applied by a source push. After observing the status from GitHub Actions, an admin
can create the rule using:

```sh
gh api --method POST repos/paulshorey/notes/rulesets \
  --input .github/pr-check-completion-ruleset.json
```

The rule was enabled after verifying that the bootstrap workflow posted the status as `github-actions[bot]`. Inspect existing rulesets first; update the current ruleset rather than creating
a duplicate:

```sh
gh api --method PUT repos/paulshorey/notes/rulesets/24278400 \
  --input .github/pr-check-completion-ruleset.json
```

A stuck external check must finish or be cancelled, or the gate must
remain pending. Investigate provider/API errors and rerun the observer. Avoid
manually setting a successful aggregate without inspecting the current checks.

To see the exact reason behind GitHub's generic rule-violation merge error, open
**Settings → Rules → Insights**, select the failed operation, and expand its
ruleset evaluation. Administrators can also read the same evidence through the
REST API:

```sh
gh api 'repos/paulshorey/notes/rulesets/rule-suites?ref=refs/heads/main&rule_suite_result=fail&per_page=10'
gh api repos/paulshorey/notes/rulesets/rule-suites/<suite-id> \
  --jq '.rule_evaluations[] | {rule_type, result, details}'
```

For example, failed suite `4305471529` for PR #88 reported
`Required status check "PR checks finished" is expected.` The gate had been
published on temporary test merge revision `716f403…`, but GitHub regenerated it
as `30c191f…` with the same parents during the merge attempt. The replacement had
no gate status. Cursor's HIGH review was a commented review and its check run
reported success; the sole live rule was the missing completion context, not a
review/security requirement.

Policy regression tests need only Node.js:

```sh
node --test .github/test/pr-check-completion.test.cjs
```

Official documentation:

- [Required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
- [Workflow events and recursion limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Secure use of pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
- [Ruleset insights](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository)
- [Head and test merge status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
