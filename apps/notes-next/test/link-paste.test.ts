import assert from "node:assert/strict"
import test from "node:test"
import {
  buildMarkdownLink,
  extractSingleAnchor,
  markdownLinkFromHtml,
  markdownLinkFromUrl,
} from "../src/components/editor/extensions/linkPaste"

test("markdownLinkFromUrl converts a standalone plain URL", () => {
  assert.equal(
    markdownLinkFromUrl(
      "https://starcraftrv.com/rvs/travel-trailers/2025-super-lite/floorplans/",
    ),
    "[starcraftrv.com/rvs/travel-trailers/2025-super-lite/floorplans](https://starcraftrv.com/rvs/travel-trailers/2025-super-lite/floorplans/)",
  )
})

test("markdownLinkFromUrl strips www from link display text", () => {
  assert.equal(
    markdownLinkFromUrl("https://www.example.com/page/"),
    "[example.com/page](https://www.example.com/page/)",
  )
})

test("markdownLinkFromUrl strips query string from link display text", () => {
  assert.equal(
    markdownLinkFromUrl("https://example.com/path?ref=abc&utm_source=x"),
    "[example.com/path](https://example.com/path?ref=abc&utm_source=x)",
  )
})

test("markdownLinkFromHtml converts a single anchor's text and href", () => {
  const parse = () => ({
    anchors: [
      {
        href: "https://www.pinterest.com/pin/zoom-travel-trailer-floorplans--26529085296736010/",
        text: "Roaming Times",
      },
    ],
    bodyText: "Roaming Times",
  })

  assert.equal(
    markdownLinkFromHtml("<a>ignored by test parser</a>", parse),
    "[Roaming Times](https://www.pinterest.com/pin/zoom-travel-trailer-floorplans--26529085296736010/)",
  )
})

test("markdownLinkFromUrl leaves normal plain text alone", () => {
  assert.equal(markdownLinkFromUrl("Roaming Times"), null)
})

test("markdownLinkFromUrl leaves multi-line text alone", () => {
  assert.equal(markdownLinkFromUrl("https://example.com\nhttps://example.org"), null)
})

test("extractSingleAnchor rejects rich html whose body text does not match the anchor", () => {
  const parse = () => ({
    anchors: [{ href: "https://example.com", text: "Example" }],
    bodyText: "Prefix Example",
  })

  assert.equal(extractSingleAnchor("<div>ignored</div>", parse), null)
})

test("markdownLinkFromHtml falls back to href-derived text when anchor text is empty", () => {
  const parse = () => ({
    anchors: [{ href: "https://example.com/path/", text: "" }],
    bodyText: "",
  })

  assert.equal(
    markdownLinkFromHtml("<a href='https://example.com/path/'></a>", parse),
    "[example.com/path](https://example.com/path/)",
  )
})

test("buildMarkdownLink escapes brackets and backslashes in link text", () => {
  assert.equal(
    buildMarkdownLink("A [label] \\ value", "https://example.com"),
    "[A \\[label\\] \\\\ value](https://example.com)",
  )
})

test("buildMarkdownLink wraps hrefs with parentheses to keep markdown valid", () => {
  assert.equal(
    buildMarkdownLink("Example", "https://example.com/path(test)"),
    "[Example](<https://example.com/path(test)>)",
  )
})
