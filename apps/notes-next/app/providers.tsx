"use client"

import { MantineProvider } from "@mantine/core"
import { ThemeProvider, ToasterComponent, ToasterProvider } from "@gravity-ui/uikit"
import { toaster } from "@gravity-ui/uikit/toaster-singleton"

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
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
  )
}
