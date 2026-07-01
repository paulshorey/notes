# CodeMirror and Atomic Editor Research

Background notes for editor customization in `apps/notes-next`. This file is research only; execution details live in the focused feature plans.

## Atomic-editor integration surface

The key integration point is `apps/notes-next/src/components/editor/AtomicEditor.tsx`, which already passes an `extensions` array into `AtomicCodeMirrorEditor`.

Important facts from `lib/atomic-editor/src/AtomicCodeMirrorEditor.tsx`:

- `AtomicCodeMirrorEditor` accepts `extensions?: readonly Extension[]`.
- Consumer extensions are appended after the built-in atomic-editor extensions.
- Those extensions are captured once per editor mount, keyed by document identity.
- The public handle exposes `focus`, `undo`, `redo`, `openSearch`, `closeSearch`, `revealText`, `isSearchOpen`, `getMarkdown`, and `getContentDOM`.
- The public handle does not expose raw `EditorView` dispatch.

Practical implication:

- App-level CodeMirror customization is possible without editing `lib/atomic-editor`.
- If a feature needs arbitrary document edits after some React UI step, the app wrapper should capture the raw `EditorView` through an extension such as `EditorView.updateListener.of(...)` and store it in a ref.

## Paste event customization

CodeMirror 6 supports direct DOM event interception through `EditorView.domEventHandlers(...)`.

Useful behavior:

- Use `paste(event, view)` to inspect clipboard data.
- Call `event.preventDefault()` and return `true` when the custom handler fully owns the paste.
- Return `false` to fall back to CodeMirror's default paste behavior.

Important precedence rule:

- CodeMirror's built-in input handling may consume paste and keydown events before lower-precedence handlers run.
- Wrap custom DOM event handlers in `Prec.high(...)` when they must run before the defaults.

## Autocomplete basics

`@codemirror/autocomplete` is already installed in `apps/notes-next/package.json`.

The usual entry point is:

```typescript
autocompletion({
  override: [myCompletionSource],
})
```

A completion source receives `CompletionContext` and returns either:

- `null` when no completions should appear
- a completion result object when completions should appear

Useful source helpers:

- `context.matchBefore(regex)` identifies a token immediately before the cursor
- `context.explicit` tells you whether completion was opened manually rather than by typing

## Custom `@` triggers

For a feature that should open only on `@`:

- use a custom completion source
- do not register a slash source
- return `null` unless the text before the cursor matches the `@` pattern

Recommended shape:

```typescript
function atTriggerSource(context: CompletionContext) {
  const match = context.matchBefore(/@\w*$/)
  if (!match && !context.explicit) {
    return null
  }

  return {
    from: match ? match.from + 1 : context.pos,
    options: [
      {label: "Link"},
      {label: "Image"},
    ],
    validFor: /^\w*$/,
  }
}
```

Why `from: match.from + 1` matters:

- the user types `@l`
- the filter text should be `l`, not `@l`
- the dropdown labels are `Link` and `Image`, not `@Link`

This means any custom `apply(...)` function must usually remove the trigger itself by editing `from - 1` through `to`.

## Custom completion actions

A completion option can provide an `apply` function instead of plain replacement text.

Useful signature:

```typescript
apply?: (
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
) => void
```

This is the hook for advanced flows such as:

- remove the typed trigger text
- open a React modal
- later insert custom markdown based on the modal result

The `apply` callback can call `view.dispatch(...)` directly.

## React and CodeMirror bridge for modal-driven insertions

This is the main architectural gap to account for in the autocomplete feature.

Because the atomic-editor handle does not expose raw dispatch, a modal-driven completion flow should bridge React and CodeMirror inside the app wrapper:

1. Keep the completion source and `apply(...)` function inside an app-level extension.
2. In `AtomicEditor.tsx`, capture the current `EditorView` in a ref via `EditorView.updateListener.of(...)`.
3. When a completion is selected, store a pending action in React state.
4. Render a React modal from that state.
5. On submit, use the stored `EditorView` ref to dispatch the markdown insertion.
6. Re-focus the editor after submit or cancel.

This keeps all behavior outside `lib/atomic-editor` while still allowing custom UI.

## Avoiding bad `@` triggers

A naive `@\w*$` source will also match some email-like content.

Useful guard:

- inspect the character immediately before `@`
- allow only start-of-line, whitespace, or a small set of opening punctuation characters
- reject when `@` is part of a word or email address

This keeps the feature from opening on text like `name@example.com`.

## Notes on modal UX

For the initial link/image autocomplete feature, the cleanest flow is:

1. user types `@`
2. dropdown shows `Link` and `Image`
3. user selects one option
4. completion `apply(...)` removes the trigger token immediately
5. modal opens
6. submit inserts final markdown at the stored position
7. cancel leaves nothing inserted

This avoids stale replacement ranges while the modal is open.

## Other useful CodeMirror techniques

Relevant extension hooks worth remembering for later work:

- `StateField` for editor-owned state
- `StateEffect` for cross-extension signaling
- `ViewPlugin` for custom DOM behavior or decorations
- `Decoration` for inline visual transformations
- `keymap.of(...)` for custom keyboard shortcuts
- `EditorView.updateListener.of(...)` for sync hooks and editor ref capture

## Related focused plans

- `docs/editor/paste-link-handling.md`
- `docs/editor/autocomplete-dropdown-handling.md`
