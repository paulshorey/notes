'use client'

import dynamic from "next/dynamic"

const EditorPage = dynamic(
  () => import("@/components/editor/EditorPage").then((mod) => mod.EditorPage),
  {
    ssr: false,
  },
)

export default function Page() {
  return <EditorPage />
}