import type { MetadataRoute } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { siteOrigin } from "@/lib/siteSeo";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  noStore();
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/org", "/api", "/login"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
