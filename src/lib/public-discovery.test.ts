import { expect, it } from "vitest";
import {
  publicMetadata,
  publicSitemap,
  privateCrawlPaths,
} from "./public-discovery";
import robots from "@/app/robots";
it("exposes only the two public documents, never account/draft URLs or root login redirects", () => {
  expect(
    publicSitemap()
      .map((p) => new URL(p.url).pathname)
      .sort(),
  ).toEqual(["/changelog", "/method"]);
  for (const entry of publicSitemap()) {
    expect(entry.url).not.toMatch(/[?#]/);
    expect(
      publicMetadata(new URL(entry.url).pathname as "/method").alternates
        ?.canonical,
    ).toBe(entry.url);
  }
  for (const path of [
    "/day",
    "/log",
    "/profile",
    "/review",
    "/api/",
    "/admin/",
  ])
    expect(privateCrawlPaths).toContain(path);
  const prior = process.env.CONTEXT;
  try {
    process.env.CONTEXT = "deploy-preview";
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  } finally {
    if (prior === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = prior;
  }
});
