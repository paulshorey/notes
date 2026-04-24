---
name: search-fallback-bootstrap
description: Bootstrap shell search tools and a fallback search workflow when Cursor indexed search is unhealthy. Use when built-in Glob, rg, or SemanticSearch return empty results for known files, or when cloud agents ripgrep or fd shell commands are not available.
---

# Search Fallback Bootstrap

## When to use

Use this skill when any of these happen:

- built-in `Glob` returns no files in a folder that clearly exists
- built-in `rg` returns no matches for exact known text or exact known files
- built-in `SemanticSearch` returns empty results across active code
- a cloud agent does not have `rg` or `fd` available in the shell

Do not assume project docs are incomplete just because indexed search failed.

## First checks

1. Confirm the directory exists with `ls`.
2. Try the built-in search tools once with a narrow, exact query.
3. If exact known paths still return empty, treat indexed search as unhealthy and switch to shell search.

## Local shell fallback

Check tool availability:

```bash
command -v rg
command -v fd
```

Typical commands:

```bash
rg -n "WidgetTagPickerActivity" "apps/notes-android"
fd "NotesHomeWidget.kt" "apps/notes-android"
fd "AGENTS.md" "apps/notes-android"
```

## Cloud agent bootstrap

In Cursor cloud environments, prefer `apt-get`:

```bash
command -v rg || true
command -v fd || command -v fdfind || true
apt-get update
apt-get install -y ripgrep fd-find
command -v fd || alias fd=fdfind
rg --version
fd --version || fdfind --version
```

If `fd` is still unavailable after install, use `fdfind` in commands instead:

```bash
fdfind "AGENTS.md" "apps/notes-android"
```

## Search workflow

1. Use `fd`/`fdfind` to locate filenames.
2. Use `rg -n` for exact content matches.
3. Use `ls` to verify parent directories before assuming a path is missing.
4. Use `ReadFile` once you know the path.
5. Read the nearest `AGENTS.md` before editing.

## Notes

- Built-in search tools may respect additional ignore/indexing rules that shell tools do not.
- If shell search works and indexed search does not, the likely problem is workspace indexing/tool health, not the repository layout.
- Keep using built-in search when it works; use shell tools as the fallback, not the default.
