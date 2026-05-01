"use client"

import React from "react"
import { Code, TextAlignLeft } from "@gravity-ui/icons"
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
import { ActionTooltip, Button, Icon } from "@gravity-ui/uikit"
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
  splitModeEnabled = false,
  toolbarVisible = false,
  placeholder,
  className,
  autofocus = false,
  stickyToolbar = false,
  settingsVisible,
  renderPreview,
}: MarkdownEditorProps) {
  const editorContainerRef = React.useRef<HTMLDivElement>(null)
  const [activeMode, setActiveMode] = React.useState<MarkdownEditorMode>(mode)
  const defaultRenderPreview = React.useCallback<RenderPreview>(
    (params) => <SplitModePreview {...params} />,
    [],
  )
  const effectiveRenderPreview = renderPreview ?? (splitMode ? defaultRenderPreview : undefined)
  const effectiveSettingsVisible = settingsVisible ?? false

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
  const nextMode = activeMode === "wysiwyg" ? "markup" : "wysiwyg"
  const modeToggleLabel =
    activeMode === "wysiwyg" ? "Switch to Markdown markup" : "Switch to visual editor"
  const ModeToggleIcon = activeMode === "wysiwyg" ? Code : TextAlignLeft

  React.useEffect(() => {
    if (editor.getValue() !== value) {
      editor.replace(value as MarkupString)
    }
  }, [editor, value])

  React.useEffect(() => {
    if (editor.currentMode !== mode) {
      editor.setEditorMode(mode)
    }
  }, [editor, mode])

  React.useEffect(() => {
    const syncValue = () => {
      onUpdate?.(editor.getValue())
    }

    const syncMode = ({ mode: nextEditorMode }: { mode: MarkdownEditorMode }) => {
      setActiveMode(nextEditorMode)
      syncValue()
    }

    const submitHandler = () => {
      const markdown = editor.getValue()
      onUpdate?.(markdown)
      onSubmit?.(markdown)
    }

    editor.on("change", syncValue)
    editor.on("change-editor-mode", syncMode)
    editor.on("submit", submitHandler)
    setActiveMode(editor.currentMode)
    return () => {
      editor.off("change", syncValue)
      editor.off("change-editor-mode", syncMode)
      editor.off("submit", submitHandler)
    }
  }, [editor, onSubmit, onUpdate])

  const toggleMode = React.useCallback(() => {
    editor.setEditorMode(nextMode)
  }, [editor, nextMode])

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
      <ActionTooltip title={modeToggleLabel}>
        <Button
          aria-label={modeToggleLabel}
          className={styles.modeToggle}
          onClick={toggleMode}
          pin="round-round"
          size="m"
          type="button"
          view="flat"
        >
          <Icon data={ModeToggleIcon} size={16} />
        </Button>
      </ActionTooltip>
      <MarkdownEditorView
        autofocus={autofocus}
        className={styles.editor}
        editor={editor}
        settingsVisible={effectiveSettingsVisible}
        stickyToolbar={stickyToolbar}
      />
    </div>
  )
}
