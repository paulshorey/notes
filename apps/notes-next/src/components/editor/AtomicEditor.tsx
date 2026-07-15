"use client"

import {
  AtomicCodeMirrorEditor,
  type AtomicCodeMirrorEditorHandle,
} from "@atomic-editor/editor"
import "@atomic-editor/editor/styles.css"
import { Prec } from "@codemirror/state"
import { keymap, placeholder } from "@codemirror/view"
import React from "react"
import { linkPasteHandler } from "@/components/editor/extensions/linkPaste"
import styles from "./AtomicEditor.module.css"

export type AtomicEditorHandle = AtomicCodeMirrorEditorHandle

export type AtomicEditorProps = {
  value?: string
  onUpdate?: (markdown: string) => void
  onLinkClick?: (url: string) => void
  placeholder?: string
  autofocus?: boolean
  className?: string
  documentId?: string | number | null
  initialSearchText?: string | null
  initialRevealText?: string | null
  pasteUrlAsMarkdown?: boolean
}

export const AtomicEditor = React.forwardRef<AtomicEditorHandle, AtomicEditorProps>(
  function AtomicEditor(
    {
      value = "",
      onUpdate,
      onLinkClick,
      placeholder: placeholderText,
      autofocus = false,
      className,
      documentId,
      initialSearchText = null,
      initialRevealText = null,
      pasteUrlAsMarkdown = false,
    },
    ref,
  ) {
    const editorHandleRef = React.useRef<AtomicCodeMirrorEditorHandle | null>(null)
    const onUpdateRef = React.useRef(onUpdate)
    onUpdateRef.current = onUpdate
    const pasteUrlAsMarkdownRef = React.useRef(pasteUrlAsMarkdown)
    pasteUrlAsMarkdownRef.current = pasteUrlAsMarkdown

    const extensions = React.useMemo(() => {
      const next = [
        Prec.low(
          keymap.of([
            {
              key: "Escape",
              run(view) {
                const active = document.activeElement
                if (active instanceof HTMLElement && view.dom.contains(active)) {
                  active.blur()
                  return true
                }

                view.contentDOM.blur()
                return true
              },
            },
          ]),
        ),
      ]

      if (placeholderText) {
        next.push(placeholder(placeholderText))
      }

      next.push(linkPasteHandler(() => pasteUrlAsMarkdownRef.current))

      return next
    }, [placeholderText])

    const resolvedDocumentId =
      documentId === undefined || documentId === null ? value : String(documentId)

    React.useImperativeHandle(
      ref,
      () => editorHandleRef.current as AtomicEditorHandle,
      [],
    )

    React.useEffect(() => {
      if (!autofocus) {
        return
      }

      let frameId = 0
      let timeoutId: number | undefined
      let attempts = 0

      const focusEditor = () => {
        if (editorHandleRef.current) {
          editorHandleRef.current.focus()
          return
        }

        attempts += 1
        if (attempts < 10) {
          timeoutId = window.setTimeout(focusEditor, 50)
        }
      }

      frameId = window.requestAnimationFrame(focusEditor)

      return () => {
        window.cancelAnimationFrame(frameId)
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId)
        }
      }
    }, [autofocus, resolvedDocumentId])

    const handleLinkClick = React.useCallback((url: string) => {
      if (onLinkClick) {
        onLinkClick(url)
        return
      }

      window.open(url, "_blank", "noopener,noreferrer")
    }, [onLinkClick])

    const handleMarkdownChange = React.useCallback((markdown: string) => {
      onUpdateRef.current?.(markdown)
    }, [])

    return (
      <div className={`${styles.editor} ${className ?? ""}`}>
        <AtomicCodeMirrorEditor
          documentId={resolvedDocumentId}
          markdownSource={value}
          onMarkdownChange={handleMarkdownChange}
          onLinkClick={handleLinkClick}
          editorHandleRef={editorHandleRef}
          extensions={extensions}
          initialSearchText={initialSearchText}
          initialRevealText={initialRevealText}
        />
      </div>
    )
  },
)
