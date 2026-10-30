import type { Metadata } from "next";

export const publicOrigin = "https://valuelog.theinternetofvalue.org";
export const publicPages = {
  "/method": {
    title: "How Value Log works: voice, review and privacy",
    description:
      "Speak your day, check the table and submit your private Value Log. Learn how Wellbeing Identity, review, calculations and data controls fit together.",
  },
  "/changelog": {
    title: "Value Log product evolution and release history",
    description:
      "A dated public history of Value Log: Google sign-in, separate private accounts, native voice logging, conversation readback and the boundaries kept intact.",
  },
} as const;
export type PublicPath = keyof typeof publicPages;
export function publicMetadata(path: PublicPath): Metadata {
  const page = publicPages[path],
    url = publicOrigin + path;
  return {
    ...page,
    metadataBase: new URL(publicOrigin),
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      ...page,
      type: "website",
      url,
      siteName: "Value Log · The Internet of Value",
      locale: "en_IN",
      images: [
        {
          url: publicOrigin + "/tilde-mark.png",
          width: 500,
          height: 500,
          alt: "The Internet of Value tilde mark",
        },
      ],
    },
    twitter: {
      card: "summary",
      ...page,
      images: [publicOrigin + "/tilde-mark.png"],
    },
  };
}
export function publicStructuredData(path: PublicPath) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://theinternetofvalue.org/#organization",
        name: "Internet of Value Research Foundation",
        url: "https://theinternetofvalue.org",
      },
      {
        "@type": "WebPage",
        "@id": publicOrigin + path + "#page",
        url: publicOrigin + path,
        name: publicPages[path].title,
        description: publicPages[path].description,
        inLanguage: "en",
        dateModified: path === "/changelog" ? "2026-10-27" : "2026-10-26",
        publisher: { "@id": "https://theinternetofvalue.org/#organization" },
        about: {
          "@type": "WebApplication",
          name: "Value Log",
          url: publicOrigin,
          applicationCategory: "LifestyleApplication",
          operatingSystem: "Web browser",
        },
      },
    ],
  };
}
export const publicSitemap = () =>
  (Object.keys(publicPages) as PublicPath[]).map((path) => ({
    url: publicOrigin + path,
    lastModified: path === "/changelog" ? "2026-10-27" : "2026-10-26",
  }));
export const privateCrawlPaths = [
  "/api/",
  "/.netlify/functions/",
  "/login",
  "/auth/",
  "/day",
  "/review",
  "/profile",
  "/log",
  "/onboarding",
  "/admin/",
  "/agent",
  "/privacy",
  "/protocol",
  "/trends",
  "/slices/",
  "/validator",
  "/communities",
  "/inbox",
  "/observer",
  "/explore",
  "/confirm",
  "/changelog/archive",
];
