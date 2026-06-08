"use client"

import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import Typography from "@tiptap/extension-typography"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import React from "react"
import styles from "./TipTapEditor.module.css"

export type TipTapEditorProps = {
  value?: string
  onUpdate?: (text: string) => void
  placeholder?: string
  autofocus?: boolean
}

function valueToContent(value: string) {
  if (value === "") {
    return ""
  }

  return {
    type: "doc",
    content: value.split("\n").map((line) => ({
      type: "paragraph",
      content: line === "" ? [] : [{ type: "text", text: line }],
    })),
  }
}

function getEditorText(editor: NonNullable<ReturnType<typeof useEditor>>) {
  return editor.getText({ blockSeparator: "\n" })
}

export function TipTapEditor({
  value = "",
  onUpdate,
  placeholder,
  autofocus = false,
}: TipTapEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Highlight,
        Typography,
        Placeholder.configure({
          placeholder: placeholder ?? "",
          showOnlyCurrent: false,
        }),
      ],
      content: valueToContent(value),
      autofocus: autofocus ? "end" : false,
      editorProps: {
        attributes: {
          class: "tiptap",
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        onUpdateRef.current?.(getEditorText(nextEditor))
      },
    },
    [placeholder],
  )

  React.useEffect(() => {
    if (!editor) {
      return
    }

    const current = getEditorText(editor)
    if (current !== value) {
      editor.commands.setContent(valueToContent(value), { emitUpdate: false })
    }
  }, [editor, value])

  React.useEffect(() => {
    if (!editor || !autofocus) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      editor.commands.focus("end")
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [autofocus, editor])

  return <EditorContent editor={editor} className={styles.editor} />
}
