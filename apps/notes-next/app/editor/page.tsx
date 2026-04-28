'use client'

import dynamic from "next/dynamic"
import styles from "./page.module.css"

const MarkdownEditor = dynamic(
  () => import("@/components/editor/MarkdownEditor").then((mod) => mod.MarkdownEditor),
  {
    ssr: false,
  },
)

export default function Page() {
  return (
    <main className={styles.page}>
      <MarkdownEditor
        autofocus
        className={styles.editor}
        mode="markup"
        splitMode="horizontal"
        splitModeEnabled
        stickyToolbar
        toolbarVisible={false}
      />
    </main>
  )
}