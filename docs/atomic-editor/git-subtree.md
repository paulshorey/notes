# `lib/atomic-editor` and git subtree

This document explains how `lib/atomic-editor` is linked to the standalone fork
[`paulshorey/atomic-editor`](https://github.com/paulshorey/atomic-editor), how to
sync between the two repos, and what each operation does to each repository.

The fork itself is based on the upstream open-source project
[`kenforthewin/atomic-editor`](https://github.com/kenforthewin/atomic-editor).

## TL;DR

- **Default:** develop in this monorepo like any other package. No submodule, no
  special clone steps, no sync commands required. Railway, CI, and fresh clones
  just work.
- **`bash scripts/atomic-editor-sync.sh push <branch>`** — sends editor commits
  from this monorepo to a branch on the fork. **Does not change this monorepo.**
- **`bash scripts/atomic-editor-sync.sh pull`** — merges changes from the fork
  into `lib/atomic-editor/` in this monorepo. **Creates a merge commit here.**
- **Upstream PRs** (fork → `kenforthewin/atomic-editor`) stay clean: only editor
  commits appear, not monorepo history.

---

## What is git subtree?

Git subtree is a way to treat a subdirectory of one repository as if it were its
own project, while still storing the files as normal files in the parent repo.

Unlike **git submodule**:

| | Submodule | Subtree (this repo) |
|---|---|---|
| Metadata file | `.gitmodules` + gitlink pointer | None |
| Fresh clone | Needs `git submodule update --init` | Just works |
| Files on disk | Empty until init | Always present |
| Railway / CI | Often breaks | No special handling |
| Sync with external repo | `git submodule` commands | `git subtree push` / `pull` (on demand) |

Unlike copying files manually, subtree **can preserve commit history** when
pushing changes to the fork and opening PRs — as long as the directory was
imported with a **non-squash** `git subtree add` (how this repo is set up).

**Important:** subtree is not a persistent "mode." Git does not track that
`lib/atomic-editor` is special. The link exists only in history and in the
commands you run when you choose to sync.

---

## Repos involved

```
kenforthewin/atomic-editor     upstream open-source project
        ↑
        │  (you open PRs here for upstream contributions)
        │
paulshorey/atomic-editor       your fork (standalone repo)
        ↑
        │  git subtree push / pull (on demand)
        │
notes monorepo                 lib/atomic-editor/ (regular files)
```

- **Monorepo (`notes`):** `lib/atomic-editor/` is a normal workspace package.
  `notes-next` depends on it via `workspace:*`.
- **Fork (`paulshorey/atomic-editor`):** standalone copy used for publishing and
  opening PRs against upstream. Has its own `package-lock.json` and
  `.github/workflows/` (those files are inert inside the monorepo but matter on
  the fork).
- **Upstream (`kenforthewin/atomic-editor`):** the original project. You never
  subtree-push directly to upstream; you push to your fork, then open a PR from
  there.

---

## Day-to-day development (no sync commands)

If you never run `atomic-editor-sync.sh`, you are developing a **pure monorepo**:

1. Edit files under `lib/atomic-editor/`.
2. Commit on your monorepo branch as usual.
3. Push to `origin` (this repo).

Nothing subtree-related happens. There is no background sync, no pointer to
bump, and no extra init step for teammates or CI.

```bash
pnpm --filter @atomic-editor/editor exec tsc -w -p tsconfig.build.json  # while editing
pnpm --filter notes-next dev
```

Build output goes to `lib/atomic-editor/dist/` (gitignored). `notes-next build`
compiles the editor first.

### Commit messages

Commits that touch `lib/atomic-editor/` may later be pushed to the fork via
`git subtree push`. Those **commit messages are preserved verbatim** in the fork
branch and in upstream PRs. Keep them focused on the editor, not the monorepo:

- Good: `fix(editor): correct table caret after IME input`
- Avoid: `fix notes-next editor bug (see JIRA-123)`

---

## Sync script: `scripts/atomic-editor-sync.sh`

Wrapper around `git subtree` for this repo's prefix and fork URL.

### Push — monorepo → fork

```bash
bash scripts/atomic-editor-sync.sh push <fork-branch>
```

**What it does:**

1. Runs `git subtree push --prefix=lib/atomic-editor <fork-url> <fork-branch>`.
2. Internally, git **splits** your monorepo history: it finds commits that
   touched `lib/atomic-editor/`, rewrites them so those files sit at the repo
   root, and pushes that synthetic history to the fork.

**What it affects:**

| Repository | Changed? |
|---|---|
| This monorepo (`notes`) | **No** — no new commit, HEAD unchanged, working tree unchanged |
| Fork (`paulshorey/atomic-editor`) | **Yes** — creates or updates `<fork-branch>` |

After pushing, open a PR on the fork (to merge into fork `main`, or directly to
upstream if that's your workflow).

`<fork-branch>` should usually be a **new feature branch name**, not `main`.

### Pull — fork → monorepo

```bash
bash scripts/atomic-editor-sync.sh pull              # default: fork main
bash scripts/atomic-editor-sync.sh pull <fork-branch>
```

**What it does:**

1. Fetches the fork branch.
2. Merges it into your **current monorepo branch** under `lib/atomic-editor/`
   using the subtree merge strategy.
3. Updates files in `lib/atomic-editor/` in your working tree.

**What it affects:**

| Repository | Changed? |
|---|---|
| This monorepo (`notes`) | **Yes** — merge commit on your branch; files under `lib/atomic-editor/` updated |
| Fork (`paulshorey/atomic-editor`) | **No** |

If the fork and your local editor changes conflict, resolve merge conflicts like
any normal git merge, then commit. Push to `origin` when ready.

### Environment override

```bash
ATOMIC_EDITOR_FORK_URL=https://github.com/paulshorey/atomic-editor.git \
  bash scripts/atomic-editor-sync.sh push my-feature
```

Default: `https://github.com/paulshorey/atomic-editor.git`

---

## Effects on each repository

### This monorepo (`notes`)

| Activity | Effect |
|---|---|
| Normal commits to `lib/atomic-editor/` | Regular monorepo commits; visible in `git log` for this repo |
| `sync.sh push` | No monorepo change |
| `sync.sh pull` | Merge commit; `lib/atomic-editor/` files updated |
| One-time `git subtree add` (already done) | Fork history grafted into monorepo ancestry under the prefix; does not affect day-to-day file layout |

The graft means the fork's past commits (e.g. `eba2066`) are real ancestors in
this repo's history graph. That ancestry is what makes future splits land cleanly
on the fork. It does **not** mean monorepo commits leak to the fork (see below).

### Fork (`paulshorey/atomic-editor`)

| Activity | Effect |
|---|---|
| You never run `sync.sh push` | Fork only changes when you push to it directly (e.g. from a local clone of the fork) |
| `sync.sh push` | New/updated branch with editor commits extracted from the monorepo |
| `sync.sh pull` | No fork change |

### Upstream (`kenforthewin/atomic-editor`)

You contribute by opening a PR **from your fork** to upstream. The subtree setup
is designed so that PR stays clean.

**Verified behavior:** when you `git subtree push` after making editor changes in
the monorepo, the fork branch contains:

- Your new editor commit(s), with messages preserved.
- Parent chain: your commit → fork `main` (`eba2066`) → upstream history.

Monorepo-only commits do **not** appear:

- `refactor: vendor atomic-editor into monorepo`
- `Merge pull request #59 ...`
- `fix(security): upgrade next ...`
- Any commit that never touched `lib/atomic-editor/`

Upstream reviewers see only your editor changes and editor-focused commit
messages — as if you had committed directly on the fork.

---

## Why non-squash? (Do not use `--squash`)

This repo imported the editor with:

```bash
git subtree add --prefix=lib/atomic-editor <fork-url> main
# intentionally NO --squash
```

| Import style | Future `subtree push` to fork | Upstream PR |
|---|---|---|
| **Non-squash** (this repo) | Clean — only new editor commits | Clean diff |
| `--squash` | Broken linkage — split has no real shared parent; fork PR may show every file as new | Polluted / huge diff |

The `atomic-editor-sync.sh` script does not pass `--squash`. Do not add it.

**Trade-off:** non-squash grafts the fork's full commit history into the
monorepo's history graph (~38 commits at time of import). That is the price of
correct, minimal sync. File contents and layout are unchanged.

---

## Manual `git subtree` commands

The script is a thin wrapper. Equivalent commands:

```bash
# Push monorepo editor changes to fork
git subtree push --prefix=lib/atomic-editor \
  https://github.com/paulshorey/atomic-editor.git my-feature

# Pull fork changes into monorepo
git subtree pull --prefix=lib/atomic-editor \
  https://github.com/paulshorey/atomic-editor.git main
```

Inspect what would be pushed without pushing:

```bash
git subtree split --prefix=lib/atomic-editor -b split-preview
git log --oneline eba2066765760852685c212fc83887d88d7e8ea3..split-preview
# should list only your editor commits, not monorepo commits
git branch -D split-preview
```

---

## Typical workflows

### Feature developed entirely in the monorepo, then contributed upstream

```bash
# 1. Develop and commit in monorepo (normal workflow)
#    ... edit lib/atomic-editor/ ...
git add lib/atomic-editor
git commit -m "feat(editor): add link autocomplete"

# 2. Push monorepo work
git push origin my-monorepo-branch

# 3. When ready to open upstream PR, push editor commits to fork
bash scripts/atomic-editor-sync.sh push link-autocomplete

# 4. On GitHub: open PR from paulshorey/atomic-editor:link-autocomplete
#    → kenforthewin/atomic-editor:main
```

### Upstream merged a fix; bring it into the monorepo

```bash
# After fork main has the upstream merge
bash scripts/atomic-editor-sync.sh pull
git push origin main
```

### Never sync — fork drifts

Valid choice. The monorepo keeps working. The fork only updates when you
explicitly push or commit to it directly. Use this if you only need the editor
inside the monorepo and rarely contribute upstream.

---

## Comparison with alternatives

| Approach | Monorepo DX | Railway / CI | Upstream PR quality |
|---|---|---|---|
| **Git submodule** (old setup) | Poor — init step, pointer bumps | Broken without workarounds | N/A (commit on fork directly) |
| **Plain vendored files** (PR #59) | Excellent | Excellent | Manual copy — no per-commit history |
| **Git subtree** (current) | Excellent | Excellent | Clean — split preserves editor commits only |

---

## Troubleshooting

### `fatal: prefix 'lib/atomic-editor' already exists` on `subtree add`

The directory already has content. `subtree add` is a one-time import; it was
already run for this repo. Use `push` / `pull` for ongoing sync.

### `git subtree push` is slow

Split walks history. For large repos this can take a minute. Subsequent pushes
are faster when git can reuse cached split points.

### Merge conflicts on `pull`

The fork and your monorepo both changed the same lines. Resolve conflicts in
`lib/atomic-editor/`, then `git add` and complete the merge commit.

### Fork branch shows unexpected commits

Ensure you are not using `--squash` on push/pull. Re-run
`git subtree split --prefix=lib/atomic-editor -b check` and inspect
`git log eba2066..check` — only editor commits should appear above the graft
point.

---

## Related

- Package location: `lib/atomic-editor/`
- Sync script: `scripts/atomic-editor-sync.sh`
- Agent quick reference: `AGENTS.md` (atomic-editor section)
- Editor architecture (package internals): `lib/atomic-editor/docs/architecture.md`
