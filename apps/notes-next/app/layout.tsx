import type { Metadata } from "next"
import "@mantine/core/styles.css"
import "@gravity-ui/uikit/styles/fonts.css"
import "@gravity-ui/uikit/styles/styles.css"
import "./globals.css"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: "Notes",
  description: "Simple notes app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
