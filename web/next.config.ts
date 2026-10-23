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
    // MazeMap tokens are used by MazeMap's browser API, so they are visible to visitors by design.
    NEXT_PUBLIC_MAZEMAP_VIEW_TOKEN: process.env.MAZEMAP_VIEW_TOKEN ?? "",
    NEXT_PUBLIC_MAZEMAP_AUTH_TOKEN: process.env.MAZEMAP_AUTH_TOKEN ?? "",
  },
};

export default nextConfig;
