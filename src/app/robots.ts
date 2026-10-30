import type { MetadataRoute } from "next";
import { privateCrawlPaths, publicOrigin } from "@/lib/public-discovery";
export default function robots(): MetadataRoute.Robots {
  if (["deploy-preview", "branch-deploy"].includes(process.env.CONTEXT ?? ""))
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: privateCrawlPaths },
    sitemap: publicOrigin + "/sitemap.xml",
  };
}
