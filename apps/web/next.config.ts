import type { NextConfig } from "next";

// The API is normally same-origin ("/api" proxy route). When
// NEXT_PUBLIC_API_URL points at a separate origin, that origin must also be
// allowed in connect-src or every fetch to the API would be blocked by CSP.
const apiUrl = process.env["NEXT_PUBLIC_API_URL"];
const apiOrigin =
  apiUrl && /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : null;

const connectSrc = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  ...(apiOrigin ? [apiOrigin] : []),
].join(" ");

// script-src keeps 'unsafe-inline' because Next.js injects inline bootstrap
// scripts; going nonce-based requires plumbing through the root layout and is
// out of scope here. No COEP / Trusted Types on purpose — breakage risk.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@studiq/types", "@studiq/api"],
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  webpack: (config) => {
    // Resolve .js imports to .ts files (needed for API package using NodeNext module resolution)
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
