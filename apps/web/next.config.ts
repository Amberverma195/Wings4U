import type { NextConfig } from "next";

// Prevent Next's build/dev tracer from writing `.next*/trace` (some Windows setups deny this file).
process.env.NEXT_TRACE_SPAN_THRESHOLD_MS =
  process.env.NEXT_TRACE_SPAN_THRESHOLD_MS ?? "2147483647";

// Prefer localhost so Windows can resolve IPv4/IPv6 consistently with `nest start` / Node listen.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3001";
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep dev on the default `.next` output while production build/start uses a separate folder.
  // This avoids dev/prod artifact collisions and stale chunk lookups on Windows.
  distDir: isDev ? ".next" : ".next-wings4u",
  // Required so the admin layout can call `forbidden()` from `next/navigation`,
  // which is what triggers Next to render `app/forbidden.tsx` with a real HTTP
  // 403 response for authenticated non-admin users.
  experimental: {
    authInterrupts: true,
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiProxyTarget}/api/:path*` },
      { source: "/ws", destination: `${apiProxyTarget}/ws` },
      { source: "/ws/:path*", destination: `${apiProxyTarget}/ws/:path*` },
      { source: "/socket.io", destination: `${apiProxyTarget}/socket.io` },
      {
        source: "/socket.io/:path*",
        destination: `${apiProxyTarget}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
