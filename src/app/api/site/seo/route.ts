import { NextRequest } from "next/server";
import { z } from "zod";
import { error, json, requireCabinet } from "@/lib/api";
import { readSiteSeo, saveSiteImage, siteOrigin, writeSiteSeo } from "@/lib/siteSeo";

export async function GET() {
  const cabinet = await requireCabinet();
  if (cabinet instanceof Response) return cabinet;
  const seo = await readSiteSeo();
  const origin = siteOrigin();
  return json({ seo, sitemapUrl: `${origin}/sitemap.xml`, robotsUrl: `${origin}/robots.txt` });
}

const textSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(400),
  keywords: z.string().trim().max(400),
  siteName: z.string().trim().min(1).max(80),
});

export async function PUT(req: NextRequest) {
  const cabinet = await requireCabinet();
  if (cabinet instanceof Response) return cabinet;
  try {
    const body = textSchema.parse(await req.json());
    const current = await readSiteSeo();
    const seo = { ...current, ...body };
    await writeSiteSeo(seo);
    return json({ seo });
  } catch (e) {
    if (e instanceof z.ZodError) return error("Заполните название и описание сайта");
    return error(e instanceof Error ? e.message : "Не удалось сохранить", 500);
  }
}

export async function POST(req: NextRequest) {
  const cabinet = await requireCabinet();
  if (cabinet instanceof Response) return cabinet;
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "favicon" && kind !== "og") return error("Укажите favicon или картинку для поиска");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Нужен файл");
  try {
    const url = await saveSiteImage(file, kind);
    const current = await readSiteSeo();
    const seo = { ...current, ...(kind === "favicon" ? { faviconUrl: url } : { ogImageUrl: url }) };
    await writeSiteSeo(seo);
    return json({ seo });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось загрузить", 400);
  }
}
