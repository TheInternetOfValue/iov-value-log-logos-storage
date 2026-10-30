import type { MetadataRoute } from "next";
import { publicSitemap } from "@/lib/public-discovery";
export default function sitemap(): MetadataRoute.Sitemap {
  return publicSitemap();
}
