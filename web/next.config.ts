import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Expose the provider switch to the browser. Values are fixed at build time.
  env: {
    NEXT_PUBLIC_MAP_PROVIDER: process.env.MAP_PROVIDER ?? "local",
    NEXT_PUBLIC_MAZEMAP_CAMPUS_ID: process.env.MAZEMAP_CAMPUS_ID ?? "",
  },
};

export default nextConfig;
