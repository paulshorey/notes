import type { Metadata, Viewport } from "next"
import "@/components/editor/TipTapStylesheet.css"
import "@mantine/core/styles.css"
import "@gravity-ui/uikit/styles/fonts.css"
import "@gravity-ui/uikit/styles/styles.css"
import "./globals.css"
import { Providers } from "./providers"
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration"
import { auth } from "@/auth"

export const metadata: Metadata = {
  title: "Notes",
  description: "Simple notes app",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Notes",
  },
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/apple-touch-icon.png",
  },
}

export const viewport: Viewport = {
  themeColor: "#2d2d3f",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth()

  return (
    <html lang="en">
      <body>
        <Providers session={session}>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
