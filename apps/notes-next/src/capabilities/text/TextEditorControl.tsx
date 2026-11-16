"use client"

import dynamic from "next/dynamic"
import type { AtomicEditorProps } from "@/components/editor/AtomicEditor"
import type { DraftControlProps } from "../types"
import type { TextDraft } from "./draft"

const AtomicEditor = dynamic<AtomicEditorProps>(
  () => import("@/components/editor/AtomicEditor").then((mod) => mod.AtomicEditor),
  {
    ssr: false,
  },
)

interface TextEditorControlProps extends DraftControlProps<TextDraft> {
  /** Identifies the document being edited; a new value swaps the editor's content. */
  documentId: string | number
  autofocus: boolean
  revealText?: string | null
  pasteUrlAsMarkdown?: boolean
  placeholder?: string
}

/** The editor for an item's text. */
export function TextEditorControl({
  draft,
  onChange,
  documentId,
  autofocus,
  revealText = null,
  pasteUrlAsMarkdown = false,
  placeholder,
}: TextEditorControlProps) {
  return (
    <AtomicEditor
      autofocus={autofocus}
      documentId={documentId}
      initialRevealText={revealText}
      pasteUrlAsMarkdown={pasteUrlAsMarkdown}
      placeholder={placeholder}
      value={draft.description}
      onUpdate={(description) => onChange(() => ({ description }))}
    />
  )
}
