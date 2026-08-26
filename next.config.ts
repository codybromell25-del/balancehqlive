import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * Vercel already sets HSTS. Everything below is absent by default and worth
 * having on an application that holds 14,000 members' contact details and a
 * year of transaction history.
 *
 * The CSP is deliberately strict on framing and object embedding but allows
 * inline styles, which Tailwind and Recharts both need. script-src stays on
 * 'self' plus the unsafe-inline/eval that Next's runtime requires in
 * development; tightening that properly means adopting nonces, which is worth
 * doing but is a change to how every page renders rather than a config tweak.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Supabase over HTTPS and websockets; nothing else may be called.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Clickjacking: nothing here should ever be framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Do not leak the dashboard URL, which carries the location filter, to
  // third parties on outbound clicks.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Credentials and tokens are decrypted server-side only.
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The dashboard renders member names, emails and revenue. Caching it
        // anywhere but the user's own browser tab would be a disclosure.
        source: "/dashboard",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
        ],
      },
    ];
  },
};

export default config;
