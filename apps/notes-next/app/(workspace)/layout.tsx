import { AppShell } from "@/components/shell/AppShell"
import { ItemsWorkspaceProvider } from "@/workspace/ItemsWorkspaceProvider"

/**
 * Every view of the workspace renders inside one provider and one shell, so moving
 * between views keeps the session, the open items, and saves that are in flight.
 */
export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ItemsWorkspaceProvider>
      <AppShell>{children}</AppShell>
    </ItemsWorkspaceProvider>
  )
}
