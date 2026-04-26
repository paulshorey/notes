/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    resolveAlias: {
      fs: { browser: "./stubs/fs.cjs" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {}
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      }
    }
    return config
  },
}

export default nextConfig
