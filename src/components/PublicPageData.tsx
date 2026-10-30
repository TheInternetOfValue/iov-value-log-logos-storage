import { publicStructuredData, type PublicPath } from "@/lib/public-discovery";
export function PublicPageData({ path }: { path: PublicPath }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(publicStructuredData(path)).replace(
          /</g,
          "\\u003c",
        ),
      }}
    />
  );
}
