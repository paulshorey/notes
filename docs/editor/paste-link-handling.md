# Paste Link Handling

This document is the source of truth for the custom paste-link feature.

## Goal

When the user pastes into the note editor, intercept the paste and, in two specific cases, insert a Markdown link instead of the raw clipboard content.

Supported transforms:

1. Plain URL: clipboard `text/plain` is a single URL starting with `http`.
2. HTML anchor: clipboard has `text/html` whose meaningful content is a single `<a>` element.

Everything else should fall through to CodeMirror's default paste handling with no behavior change.

## Desired behavior

### Case 1: plain URL

Input:

```text
https://starcraftrv.com/rvs/travel-trailers/2025-super-lite/floorplans/
```

Output:

```markdown
[starcraftrv.com/rvs/travel-trailers/2025-super-lite/floorplans](https://starcraftrv.com/rvs/travel-trailers/2025-super-lite/floorplans/)
```

Rules:

- Keep the pasted URL unchanged in the link target.
- Build the display text from the same URL.
- Strip only the leading `http://` or `https://` from the display text.
- Strip only one trailing `/` from the display text.

### Case 2: HTML anchor

Input `text/plain`:

```text
Roaming Times
```

Input `text/html`:

```html
<a href="https://www.pinterest.com/pin/zoom-travel-trailer-floorplans--26529085296736010/">
  <h1>Roaming Times</h1>
</a>
```

Output:

```markdown
[Roaming Times](https://www.pinterest.com/pin/zoom-travel-trailer-floorplans--26529085296736010/)
```

Rules:

- Prefer `text/html` over `text/plain` when a meaningful single anchor is present.
- Strip inner tags and use only the visible anchor text.
- If the anchor has no visible text, derive link text from the URL using the plain-URL display rules.

## Why this can live outside `lib/atomic-editor`

`AtomicCodeMirrorEditor` in `lib/atomic-editor/src/AtomicCodeMirrorEditor.tsx` accepts `extensions?: readonly Extension[]`, and `apps/notes-next/src/components/editor/AtomicEditor.tsx` already passes its own `extensions` array into that prop.

Because atomic-editor keeps raw markdown as the source of truth, inserting `[text](url)` at the document level is the correct integration point. The live preview will render the link automatically, but the stored content remains normal markdown.

## Critical CodeMirror requirement

The paste handler must use `Prec.high(...)`.

Reason: CodeMirror's built-in paste/input handling can claim the event before lower-precedence `domEventHandlers` run. Without `Prec.high`, the custom handler may never see the paste event.

## Implementation shape

### 1. Add a dedicated extension module

Create:

- `apps/notes-next/src/components/editor/extensions/linkPaste.ts`

This file should contain both:

- pure helper functions for parsing and formatting
- the actual CodeMirror extension factory

Keep parsing/formatting logic independent from DOM and CodeMirror wherever possible so it can be unit-tested easily.

### 2. Add pure helpers

Recommended helper surface:

- `isStandaloneUrl(text: string): boolean`
  - trim input
  - require the entire string to be a single token
  - require `http://` or `https://`
  - validate via `new URL(...)`
- `formatUrlDisplayText(url: string): string`
  - remove `http://` or `https://`
  - remove one trailing `/`
- `escapeLinkText(text: string): string`
  - escape `\`, `[`, `]`
- `formatLinkHref(url: string): string`
  - if the URL contains whitespace or parentheses, wrap it in `<...>` so the markdown remains valid
- `buildMarkdownLink(text: string, url: string): string`
  - return `[escapedText](formattedHref)`
- `markdownLinkFromUrl(plain: string): string | null`
  - convert only when the clipboard contains a single valid `http(s)` URL
- `extractSingleAnchor(html: string, parse?): { text: string; href: string } | null`
  - use a browser `DOMParser` by default
  - allow an injected parser in tests
  - require exactly one non-empty anchor href
  - require the document body's visible text to match the anchor's visible text so random rich HTML does not get hijacked
- `markdownLinkFromHtml(html: string, parse?): string | null`
  - convert HTML anchor content into markdown

### 3. Add the paste handler extension

Recommended factory:

- `linkPasteHandler(): Extension`

Implementation sketch:

```typescript
import { EditorSelection, Prec, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

export function linkPasteHandler(): Extension {
  return Prec.high(
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData
        if (!data) return false

        const html = data.getData("text/html")
        const plain = data.getData("text/plain")

        const markdown =
          (html ? markdownLinkFromHtml(html) : null) ??
          (plain ? markdownLinkFromUrl(plain) : null)

        if (!markdown) {
          return false
        }

        event.preventDefault()

        const transaction = view.state.changeByRange((range) => ({
          changes: {from: range.from, to: range.to, insert: markdown},
          range: EditorSelection.cursor(range.from + markdown.length),
        }))

        view.dispatch(transaction, {
          userEvent: "input.paste",
          scrollIntoView: true,
        })

        return true
      },
    }),
  )
}
```

Important details:

- `changeByRange(...)` correctly handles replacement of a selection and multi-cursor cases.
- `userEvent: "input.paste"` keeps undo behavior aligned with normal paste.
- Returning `false` is the correct fallback path when the clipboard content should not be transformed.

### 4. Wire the extension into the app wrapper

Update `apps/notes-next/src/components/editor/AtomicEditor.tsx`:

- import `linkPasteHandler`
- push it into the existing `extensions` array inside the current `useMemo`

No changes should be made to `lib/atomic-editor`.

### 5. Add focused tests

Create:

- `apps/notes-next/test/link-paste.test.ts`

Test the pure helpers, not full browser paste behavior.

Minimum cases:

1. plain URL example from this doc
2. HTML anchor example from this doc
3. non-URL plain text -> no conversion
4. multiple-line plain text -> no conversion
5. full HTML document with unrelated markup -> no conversion
6. empty anchor text -> derive display text from href
7. display text escaping for brackets and backslashes

## Edge cases and decisions

- Plain text with spaces, multiple lines, or no `http(s)` prefix -> default paste
- `http://example.com` -> display text becomes `example.com`
- `https://example.com/` -> display text becomes `example.com`, href stays unchanged
- HTML with multiple anchors -> default paste
- HTML where visible body text does not equal the anchor text -> default paste
- HTML anchor with non-HTTP href -> allowed for HTML case unless product requirements change
- Feature is always on for the notes editor; no new public prop is required
+ Feature is off by default. When `preferences.notesApp.pasteUrlAsMarkdown` is
+ `true`, the notes editor enables the paste handler via `AtomicEditor`'s
+ `pasteUrlAsMarkdown` prop. The toggle lives in the NotesHeader user menu for
+ now; a dedicated settings page may follow later.

## Acceptance criteria

The implementation is done when all of the following are true:

1. Pasting a standalone `http(s)` URL inserts a markdown link using the specified display-text rules.
2. Pasting a copied HTML link inserts a markdown link using the anchor text and href.
3. Pasting normal text behaves exactly as before.
4. The inserted markdown renders correctly through atomic-editor live preview.
5. `pnpm --filter notes-next verify` passes.
