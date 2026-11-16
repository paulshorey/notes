"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useItemsWorkspaceController, type ItemsWorkspace } from "./useItemsWorkspaceController"

const ItemsWorkspaceContext = createContext<ItemsWorkspace | null>(null)

/** Runs the workspace controller once for every view rendered inside it. */
export function ItemsWorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useItemsWorkspaceController()
  return (
    <ItemsWorkspaceContext.Provider value={workspace}>{children}</ItemsWorkspaceContext.Provider>
  )
}

/** The session, its data, the open-entry ring, and the actions on them. */
export const useItemsWorkspace = (): ItemsWorkspace => {
  const workspace = useContext(ItemsWorkspaceContext)
  if (!workspace) throw new Error("useItemsWorkspace must be used inside ItemsWorkspaceProvider.")
  return workspace
}
