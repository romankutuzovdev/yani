import { prisma } from "@/lib/db";
import { siteOrigin } from "@/lib/siteSeo";

type Params = { params: Promise<{ slug: string }> };

const FALLBACK = "/characters/yani/idle.png";

function absolute(origin: string, url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function icons(origin: string, homeIconUrl: string) {
  if (homeIconUrl.endsWith("-512.png")) {
    const large = absolute(origin, homeIconUrl);
    const small = large.replace(/-512\.png$/, "-192.png");
    return [
      { src: small, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: large, sizes: "512x512", type: "image/png", purpose: "any" },
    ];
  }
  const src = absolute(origin, homeIconUrl || FALLBACK);
  return [{ src, sizes: "1024x1024", type: "image/png", purpose: "any" }];
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const agent = await prisma.agent.findUnique({
    where: { slug },
    select: { id: true, name: true, description: true, homeIconUrl: true, enabled: true },
  });
  const org = agent
    ? await prisma.user.findFirst({
        where: { orgAgentId: agent.id, role: "ORG" },
        select: { orgName: true },
      })
    : null;
  const orgName = org?.orgName?.trim() || "";
  const name = agent?.enabled ? orgName || agent.name : "Yani";
  const origin = siteOrigin();
  const launch = `/chat?slug=${encodeURIComponent(slug)}`;
  const body = {
    name,
    short_name: name.slice(0, 12),
    description: agent?.enabled ? agent.description : "Чат с AI-агентом",
    start_url: launch,
    scope: "/",
    id: `/app/${encodeURIComponent(slug)}`,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#d8c6fb",
    lang: "ru",
    icons: icons(origin, agent?.enabled ? agent.homeIconUrl : ""),
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
