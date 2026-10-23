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
  // The app lives on "/" and keeps its view in the query string. Short, guessable paths such as
  // /ar or /map open the matching tab instead of a 404; leftovers like /web or /index.html go home.
  redirects() {
    const tabs = ["ar", "map", "navigate", "explore", "saved"];
    return [
      ...tabs.flatMap((tab) =>
        [tab, tab.toUpperCase(), tab[0].toUpperCase() + tab.slice(1)].map((p) => ({
          source: `/${p}`,
          destination: `/?tab=${tab}`,
          permanent: false,
        })),
      ),
      { source: "/web", destination: "/", permanent: false },
      { source: "/web/:path*", destination: "/", permanent: false },
      { source: "/index.html", destination: "/", permanent: false },
      { source: "/home", destination: "/", permanent: false },
    ];
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
