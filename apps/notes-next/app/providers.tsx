"use client"

import { MantineProvider } from "@mantine/core"
import { ThemeProvider, ToasterComponent, ToasterProvider } from "@gravity-ui/uikit"
import { toaster } from "@gravity-ui/uikit/toaster-singleton"
import { SessionProvider } from "next-auth/react"
import type { Session } from "next-auth"

export function Providers({
  children,
  session,
}: Readonly<{ children: React.ReactNode; session: Session | null }>) {
  return (
    <SessionProvider session={session}>
      <MantineProvider
        defaultColorScheme="dark"
        theme={{
          fontFamily: "var(--g-font-family-sans, Inter, system-ui, sans-serif)",
        }}
      >
        <ThemeProvider theme="dark">
          <ToasterProvider toaster={toaster}>
            {children}
            <ToasterComponent />
          </ToasterProvider>
        </ThemeProvider>
      </MantineProvider>
    </SessionProvider>
  )
}
