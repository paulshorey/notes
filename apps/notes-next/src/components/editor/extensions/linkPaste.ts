import { EditorSelection, Prec, type Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

export type ParsedHtmlAnchor = {
  href: string
  text: string
}

export type ParsedHtmlAnchorDocument = {
  anchors: ParsedHtmlAnchor[]
  bodyText: string
}

export type HtmlAnchorParser = (html: string) => ParsedHtmlAnchorDocument | null

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim()

export const parseHtmlAnchorsWithDomParser: HtmlAnchorParser = (html) => {
  if (typeof DOMParser === "undefined") {
    return null
  }

  const document = new DOMParser().parseFromString(html, "text/html")
  const anchors = Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => ({
      href: anchor.getAttribute("href")?.trim() ?? "",
      text: collapseWhitespace(anchor.textContent ?? ""),
    }))
    .filter((anchor) => anchor.href !== "")

  return {
    anchors,
    bodyText: collapseWhitespace(document.body?.textContent ?? ""),
  }
}

export function isStandaloneUrl(text: string): boolean {
  const candidate = text.trim()
  if (candidate === "" || /\s/.test(candidate) || !/^https?:\/\//i.test(candidate)) {
    return false
  }

  try {
    new URL(candidate)
    return true
  } catch {
    return false
  }
}

export function formatUrlDisplayText(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "")
}

export function escapeLinkText(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]")
}

export function formatLinkHref(url: string): string {
  return /[\s()]/.test(url) ? `<${url}>` : url
}

export function buildMarkdownLink(text: string, url: string): string {
  return `[${escapeLinkText(text)}](${formatLinkHref(url)})`
}

export function markdownLinkFromUrl(plain: string): string | null {
  const candidate = plain.trim()
  if (!isStandaloneUrl(candidate)) {
    return null
  }

  return buildMarkdownLink(formatUrlDisplayText(candidate), candidate)
}

export function extractSingleAnchor(
  html: string,
  parse: HtmlAnchorParser = parseHtmlAnchorsWithDomParser,
): ParsedHtmlAnchor | null {
  const parsed = parse(html)
  if (!parsed || parsed.anchors.length !== 1) {
    return null
  }

  const anchor = parsed.anchors[0]
  if (!anchor || parsed.bodyText !== anchor.text) {
    return null
  }

  return anchor
}

export function markdownLinkFromHtml(
  html: string,
  parse: HtmlAnchorParser = parseHtmlAnchorsWithDomParser,
): string | null {
  const anchor = extractSingleAnchor(html, parse)
  if (!anchor) {
    return null
  }

  return buildMarkdownLink(
    anchor.text === "" ? formatUrlDisplayText(anchor.href) : anchor.text,
    anchor.href,
  )
}

export function linkPasteHandler(): Extension {
  return Prec.high(
    EditorView.domEventHandlers({
      paste(event, view) {
        const data = event.clipboardData
        if (!data) {
          return false
        }

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
          changes: { from: range.from, to: range.to, insert: markdown },
          range: EditorSelection.cursor(range.from + markdown.length),
        }))

        view.dispatch({
          ...transaction,
          scrollIntoView: true,
          userEvent: "input.paste",
        })

        return true
      },
    }),
  )
}
