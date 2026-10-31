import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: lets a browser on another machine load dev assets via this server's LAN / Tailscale address.
  allowedDevOrigins: ["10.2.103.136", "100.90.114.98", "krs-server-1"],
  // The demo catalogue ships its own images; no remote hosts are allowlisted.
  // Add explicit hosts here if a real product provider is connected (never wildcard).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.trychannel3.com",
      },
      {
        protocol: "https",
        hostname: "*.trychannel3.com",
      },
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
        // CSS Modules keep Turbopack's built-in pipeline; `as: "*.css"` would turn them into global CSS.
        condition: { not: { path: /\.module\.css$/ } },
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
