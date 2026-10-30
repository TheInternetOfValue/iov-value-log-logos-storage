import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@theinternetofvalue/wellbeing-identity-contracts", "@theinternetofvalue/wellbeing-identity-renderer"],
  async headers() {
    const security = [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/(.*)", headers: security },
      { source: "/:private(day|review|trends|profile|slices|api|privacy|onboarding|log|admin|agent)/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/log", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" }] },
      { source: "/day", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" }] },
      { source: "/changelog/2026/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // The shared layout includes account-dependent navigation. Indexable does
      // not mean publicly cacheable until these pages have a static public shell.
      { source: "/method", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "index, follow" }] },
      { source: "/changelog", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "index, follow" }] },
      { source: "/changelog/archive", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
