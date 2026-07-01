# Autocomplete Dropdown Handling

This document is the source of truth for the custom `@` autocomplete feature.

## Goal

When the user types `@` in the note editor, show a CodeMirror autocomplete dropdown with exactly 2 options:

- `Link`
- `Image`

Do not add slash-triggered autocomplete in this feature. Typing `/` should behave exactly as it does today.

Selecting an option should open a modal and, after submit, insert markdown at the trigger location.

## Desired behavior

### Trigger

- Typing `@` opens the dropdown immediately.
- Typing `@l` filters toward `Link`.
- Typing `@i` filters toward `Image`.
- Typing `/` does nothing special.

### Link action

When the user selects `Link`:

1. open a modal
2. show 2 required fields:
   - link text
   - link URL
3. when the user submits valid values, replace the original trigger token with:

```markdown
[link text](link url)
```

### Image action

When the user selects `Image`:

1. open a modal
2. show 2 fields:
   - alt text (optional)
   - image URL (required)
3. when the user submits valid values, replace the original trigger token with:

```markdown
![alt text](image url)
```

If alt text is blank, insert:

```markdown
![](image url)
```

## Why this can live outside `lib/atomic-editor`

`AtomicCodeMirrorEditor` already accepts external CodeMirror extensions, and `apps/notes-next/src/components/editor/AtomicEditor.tsx` is the app-specific wrapper around it.

That wrapper is the correct place to combine:

- CodeMirror autocomplete behavior
- React modal state
- markdown insertion logic

No changes are required in `lib/atomic-editor`.

## Core design decision

Keep the modal flow inside `apps/notes-next/src/components/editor/AtomicEditor.tsx` rather than pushing it up into `NoteForm.tsx`.

Reason:

- the behavior is editor-specific, not note-form-specific
- the raw atomic-editor handle does not expose generic `EditorView` dispatch
- keeping the bridge local avoids a larger prop API and keeps the implementation easier to execute

## Required architecture

### 1. Add a dedicated autocomplete extension module

Create:

- `apps/notes-next/src/components/editor/extensions/autocompleteActions.ts`

This module should export:

- autocomplete action types
- small pure helpers
- the CodeMirror autocomplete extension factory

Recommended types:

```typescript
export type AutocompleteActionKind = "link" | "image"

export type PendingAutocompleteAction = {
  kind: AutocompleteActionKind
  insertFrom: number
}
```

The pending action only needs a single insertion point if the trigger token is removed immediately when the action is chosen.

### 2. Use a custom `@` completion source

Use `autocompletion({ override: [source] })` with a fully custom source.

Recommended behavior:

- only return completions for `@`
- never register a slash source
- return `from: match.from + 1` so filtering uses text after `@`
- return `validFor: /^\w*$/` so the same result stays active while the user types letters after `@`

Recommended source sketch:

```typescript
function atActionSource(context: CompletionContext) {
  const match = context.matchBefore(/@\w*$/)
  if (!match) {
    return null
  }

  const charBeforeAt =
    match.from > 0 ? context.state.sliceDoc(match.from - 1, match.from) : ""

  const safeBoundary =
    match.from === 0 || /[\s([{:>"'`]/.test(charBeforeAt)

  if (!safeBoundary) {
    return null
  }

  return {
    from: match.from + 1,
    options: [
      {
        label: "Link",
        apply(view, completion, from, to) {
          // custom action
        },
      },
      {
        label: "Image",
        apply(view, completion, from, to) {
          // custom action
        },
      },
    ],
    validFor: /^\w*$/,
  }
}
```

Why `from: match.from + 1` matters:

- CodeMirror will filter the option labels against the typed query
- with `@l`, the query should be `l`
- if `from` includes the `@`, the filter text becomes `@l`, which does not match `Link`

### 3. Remove the trigger token immediately when an option is chosen

When `Link` or `Image` is selected, the custom `apply(...)` function should:

1. remove the trigger token from the document
2. move the selection to the insertion point
3. open the React modal
4. store the insertion point in React state

Recommended implementation detail:

- if the completion result returns `from: match.from + 1`, then the actual trigger starts at `from - 1`
- remove `from - 1` through `to`

Sketch:

```typescript
apply(view, completion, from, to) {
  const insertFrom = from - 1

  view.dispatch({
    changes: {from: insertFrom, to, insert: ""},
    selection: {anchor: insertFrom},
    scrollIntoView: true,
  })

  openAction({
    kind: "link",
    insertFrom,
  })
}
```

This is the simplest and safest approach for the modal flow:

- no stale replacement range while the modal is open
- cancel leaves nothing inserted
- submit inserts at a stable position

## React and CodeMirror bridge

`AtomicCodeMirrorEditorHandle` does not expose raw `EditorView` dispatch, so `AtomicEditor.tsx` should capture it locally.

### In `AtomicEditor.tsx`

Add:

- `const editorViewRef = React.useRef<EditorView | null>(null)`
- an `EditorView.updateListener.of((update) => { editorViewRef.current = update.view })` extension
- local state for the pending autocomplete action
- local state for modal form values

This lets the completion extension and the modal share the same editor instance without changing `lib/atomic-editor`.

## Modal UI

Create a small modal component in the editor folder, for example:

- `apps/notes-next/src/components/editor/InsertMarkdownModal.tsx`

Use existing app conventions:

- `@gravity-ui/uikit` `Modal`
- `TextInput`
- `Button`

Keep it simple and focused:

- title changes based on `link` vs `image`
- first field auto-focuses
- submit button disabled until required values are present
- cancel closes the modal
- submit inserts markdown, closes the modal, and re-focuses the editor

### Suggested props

```typescript
type InsertMarkdownModalProps = {
  open: boolean
  kind: "link" | "image" | null
  linkText: string
  linkUrl: string
  imageAlt: string
  imageUrl: string
  onLinkTextChange: (value: string) => void
  onLinkUrlChange: (value: string) => void
  onImageAltChange: (value: string) => void
  onImageUrlChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}
```

## Markdown builders

This feature should use small pure helpers for final insertion strings.

Recommended helpers:

- `buildMarkdownLink(text: string, url: string): string`
- `buildMarkdownImage(alt: string, url: string): string`

If the paste-link work already landed first, either:

- reuse `buildMarkdownLink` from that implementation, or
- extract shared markdown builders into a small editor utility file as part of this feature

Do not block this feature on a large refactor; a tiny shared utility is enough.

## File plan

### `apps/notes-next/src/components/editor/extensions/autocompleteActions.ts`

Responsibilities:

- `@` completion source
- option definitions for `Link` and `Image`
- `validFor` behavior
- boundary checks so the feature does not trigger inside emails
- custom `apply(...)` callbacks that remove the trigger token and open the modal flow

### `apps/notes-next/src/components/editor/InsertMarkdownModal.tsx`

Responsibilities:

- render the link/image modal
- validate required fields
- stay presentation-focused

### `apps/notes-next/src/components/editor/AtomicEditor.tsx`

Responsibilities:

- capture `EditorView`
- create the autocomplete extension with stable React callbacks
- hold pending action state
- submit/cancel the modal
- dispatch the final markdown insertion

## Submit flow

### Link

On submit:

1. trim the link text and URL
2. validate both are non-empty
3. build `[text](url)`
4. dispatch insertion at `insertFrom`
5. move the cursor to the end of the inserted markdown
6. close the modal
7. focus the editor

### Image

On submit:

1. trim the alt text and URL
2. validate URL is non-empty
3. build `![alt](url)` or `![](url)`
4. dispatch insertion at `insertFrom`
5. move the cursor to the end
6. close the modal
7. focus the editor

## Edge cases and decisions

- Trigger only on `@`, never on `/`
- Do not trigger when `@` is embedded in a word or email address
- Typing `@` followed by letters should keep the dropdown open and filter options
- Choosing an option removes the trigger token immediately
- Canceling the modal leaves nothing inserted
- Link submit requires both fields
- Image submit requires only the URL
- Re-focus the editor after submit or cancel
- This feature is intentionally text-only for now; image rendering improvements are out of scope

## Suggested tests

Add focused unit tests for the pure logic:

- `@` boundary detection
- `buildMarkdownLink`
- `buildMarkdownImage`
- trigger query filtering assumptions

Manual verification should cover:

1. type `@` -> dropdown appears
2. type `/` -> no dropdown
3. choose `Link` -> modal opens
4. submit `Link` -> markdown link inserted
5. choose `Image` -> modal opens
6. submit `Image` with alt text -> markdown image inserted
7. submit `Image` without alt text -> `![](url)` inserted
8. type `name@example.com` -> dropdown does not appear

## Acceptance criteria

The implementation is done when all of the following are true:

1. Typing `@` opens a dropdown with only `Link` and `Image`.
2. Typing `/` does not open the dropdown.
3. Selecting `Link` opens a modal and inserts `[text](url)` after submit.
4. Selecting `Image` opens a modal and inserts `![alt](url)` or `![](url)` after submit.
5. Selecting an option removes the trigger token cleanly.
6. The editor regains focus after submit or cancel.
7. `pnpm --filter notes-next verify` passes.
