import process from "node:process"

/** @type {import("next").NextConfig} */
const nextConfig = {
  devIndicators: false,
  allowedDevOrigins: [
    "127.0.0.1",
    "192.168.1.87",
    ...(process.env.TAILSCALE_DEV_HOST ? [process.env.TAILSCALE_DEV_HOST] : []),
  ],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ]
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: "./stubs/fs.cjs" },
    },
  },
}

export default nextConfig
