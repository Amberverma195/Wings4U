import type { NextConfig } from "next";

// Prevent Next's build/dev tracer from writing `.next*/trace` (some Windows setups deny this file).
process.env.NEXT_TRACE_SPAN_THRESHOLD_MS =
  process.env.NEXT_TRACE_SPAN_THRESHOLD_MS ?? "2147483647";

// Prefer localhost so Windows can resolve IPv4/IPv6 consistently with `nest start` / Node listen.
const isVercel = process.env.VERCEL === "1";
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);

if (isVercel && !process.env.API_PROXY_TARGET?.trim()) {
  throw new Error(
    "API_PROXY_TARGET is required on Vercel. Set it to your public Railway Nest API URL " +
      "(e.g. https://your-service.up.railway.app) in Project > Settings > Environment Variables, " +
      "then redeploy. Without it, /api/* rewrites hit localhost and return HTML 404 pages.",
  );
}

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep local production builds in a separate folder to avoid dev/prod artifact
  // collisions on Windows, but let Vercel use Next's standard `.next` output.
  distDir: isDev || isVercel ? ".next" : ".next-wings4u",
  // Required so the admin layout can call `forbidden()` from `next/navigation`,
  // which is what triggers Next to render `app/forbidden.tsx` with a real HTTP
  // 403 response for authenticated non-admin users.
  experimental: {
    authInterrupts: true,
    optimizePackageImports: ["@chakra-ui/react"],
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
