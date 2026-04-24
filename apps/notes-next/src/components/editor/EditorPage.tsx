import { createElement } from "react"
import type { ComponentType } from "react"
import { MarkdownEditorView, useMarkdownEditor } from "@gravity-ui/markdown-editor"

import styles from "./EditorPage.module.css"

const ClientMarkdownEditorView = MarkdownEditorView as unknown as ComponentType<
  Record<string, unknown>
>

export function EditorPage() {
  const editor = useMarkdownEditor({
    md: {
      html: false,
    },
    initial: {
      markup: "",
    },
  })

  return createElement(
    "main",
    { className: styles.page },
    createElement(ClientMarkdownEditorView, {
      autofocus: true,
      className: styles.editor,
      editor,
      stickyToolbar: true,
    }),
  )
}
