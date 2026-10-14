import type { MetadataRoute } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { siteOrigin } from "@/lib/siteSeo";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  noStore();
  const origin = siteOrigin();
  const lastModified = new Date();
  return [
    { url: `${origin}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/chat`, lastModified, changeFrequency: "weekly", priority: 0.9 },
  ];
}
