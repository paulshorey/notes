"use client"

import React from "react"
import {
  MarkdownEditorView,
  useMarkdownEditor,
  type MarkdownEditorMode,
  type MarkdownEditorOptions,
  type MarkdownEditorSplitMode,
  type MarkdownEditorViewProps,
  type MarkupString,
  type RenderPreview,
} from "@gravity-ui/markdown-editor"
import styles from "./MarkdownEditor.module.css"
import { SplitModePreview } from "./SplitModePreview"

export type MarkdownEditorProps = {
  value?: string
  onUpdate?: (markdown: string) => void
  onSubmit?: (markdown: string) => void
  mode?: MarkdownEditorMode
  splitMode?: MarkdownEditorSplitMode
  splitModeEnabled?: boolean
  toolbarVisible?: boolean
  placeholder?: string
  className?: string
  autofocus?: boolean
  stickyToolbar?: boolean
  settingsVisible?: MarkdownEditorViewProps["settingsVisible"]
  renderPreview?: RenderPreview
}

export function MarkdownEditor({
  value = "",
  onUpdate,
  onSubmit,
  mode = "wysiwyg",
  splitMode = "vertical",
  splitModeEnabled = true,
  toolbarVisible = false,
  placeholder,
  className,
  autofocus = false,
  stickyToolbar = false,
  settingsVisible,
  renderPreview,
}: MarkdownEditorProps) {
  const editorContainerRef = React.useRef<HTMLDivElement>(null)
  const defaultRenderPreview = React.useCallback<RenderPreview>(
    (params) => <SplitModePreview {...params} />,
    [],
  )
  const effectiveRenderPreview = renderPreview ?? (splitMode ? defaultRenderPreview : undefined)

  const editorOptions = React.useMemo<MarkdownEditorOptions>(
    () => ({
      initial: {
        markup: value as MarkupString,
        mode,
        splitModeEnabled,
        toolbarVisible,
      },
      markupConfig: {
        splitMode,
        renderPreview: effectiveRenderPreview,
        placeholder,
      },
      wysiwygConfig: {
        placeholderOptions: placeholder ? { value: placeholder } : undefined,
      },
    }),
    [effectiveRenderPreview, mode, placeholder, splitMode, splitModeEnabled, toolbarVisible, value],
  )
  const editor = useMarkdownEditor(editorOptions, [
    effectiveRenderPreview,
    mode,
    placeholder,
    splitMode,
    splitModeEnabled,
    toolbarVisible,
  ])

  React.useEffect(() => {
    if (editor.getValue() !== value) {
      editor.replace(value as MarkupString)
    }
  }, [editor, value])

  React.useEffect(() => {
    const syncValue = () => {
      onUpdate?.(editor.getValue())
    }

    const submitHandler = () => {
      const markdown = editor.getValue()
      onUpdate?.(markdown)
      onSubmit?.(markdown)
    }

    editor.on("change", syncValue)
    editor.on("change-editor-mode", syncValue)
    editor.on("submit", submitHandler)
    return () => {
      editor.off("change", syncValue)
      editor.off("change-editor-mode", syncValue)
      editor.off("submit", submitHandler)
    }
  }, [editor, onSubmit, onUpdate])

  React.useEffect(() => {
    if (!autofocus) {
      return
    }

    let frameId = 0
    let timeoutId: number | undefined
    let attempts = 0

    const focusEditor = () => {
      const editorElement = editorContainerRef.current?.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      )

      if (editorElement) {
        editorElement.focus()
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
  }, [autofocus])

  return (
    <div ref={editorContainerRef} className={`${styles.editor} ${className ?? ""}`}>
      <MarkdownEditorView
        autofocus={autofocus}
        className={styles.editor}
        editor={editor}
        settingsVisible={settingsVisible}
        stickyToolbar={stickyToolbar}
      />
    </div>
  )
}
