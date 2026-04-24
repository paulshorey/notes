/**
 * Base Next.js configuration shared across all apps
 * Apps can extend this by spreading the config and overriding specific properties
 */

/** @type {import('next').NextConfig} */
const baseNextConfig = {
  transpilePackages: ["@lib/config"],
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
        port: "",
        pathname: "**",
      },
    ],
  },
};

module.exports = baseNextConfig;
