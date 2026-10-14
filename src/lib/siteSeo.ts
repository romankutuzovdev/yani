import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export type SiteSeo = {
  title: string;
  description: string;
  keywords: string;
  siteName: string;
  faviconUrl: string;
  ogImageUrl: string;
};

const DEFAULTS: SiteSeo = {
  title: "Yani — AI-агент с персонажем",
  description: "Чат с AI-агентом, навыками и персонажем",
  keywords: "Yani, AI, чат, агент",
  siteName: "Yani",
  faviconUrl: "",
  ogImageUrl: "",
};

function filePath() {
  return path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "site-seo.json");
}

export function siteOrigin() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://yani.by";
  return raw.replace(/\/$/, "");
}

const SITE_IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export type SiteFavicon = {
  href: string;
  type: string;
  filePath: string;
};

export async function resolveSiteFavicon(seo?: SiteSeo): Promise<SiteFavicon | null> {
  const current = seo ?? (await readSiteSeo());
  const raw = current.faviconUrl.split("?")[0].trim();
  const prefix = "/uploads/site/";
  if (!raw.startsWith(prefix)) return null;
  const name = raw.slice(prefix.length);
  if (!name || name !== path.basename(name) || !/^[\w.-]+$/.test(name)) return null;
  const iconFile = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "site", name);
  try {
    const info = await stat(iconFile);
    if (!info.isFile() || info.size <= 0) return null;
    const type = SITE_IMAGE_MIME[path.extname(name).toLowerCase()];
    if (!type) return null;
    return {
      href: `${prefix}${name}?v=${Math.trunc(info.mtimeMs)}`,
      type,
      filePath: iconFile,
    };
  } catch {
    return null;
  }
}

export async function readSiteSeo(): Promise<SiteSeo> {
  try {
    const raw = JSON.parse(await readFile(filePath(), "utf8")) as Partial<SiteSeo>;
    return {
      title: String(raw.title ?? DEFAULTS.title).trim() || DEFAULTS.title,
      description: String(raw.description ?? DEFAULTS.description).trim() || DEFAULTS.description,
      keywords: String(raw.keywords ?? DEFAULTS.keywords).trim(),
      siteName: String(raw.siteName ?? DEFAULTS.siteName).trim() || DEFAULTS.siteName,
      faviconUrl: String(raw.faviconUrl ?? "").trim(),
      ogImageUrl: String(raw.ogImageUrl ?? "").trim(),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeSiteSeo(next: SiteSeo) {
  const dir = path.dirname(filePath());
  await mkdir(dir, { recursive: true });
  await writeFile(filePath(), JSON.stringify(next, null, 2));
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

export async function saveSiteImage(file: File, kind: "favicon" | "og") {
  const name = (file.name || "").toLowerCase();
  let ext = IMAGE_EXT[file.type] || "";
  if (!ext && name.endsWith(".ico")) ext = "ico";
  if (!ext && name.endsWith(".svg")) ext = "svg";
  if (!ext && name.endsWith(".png")) ext = "png";
  if (kind === "og" && (ext === "ico" || ext === "svg")) {
    throw new Error("Для картинки в поиске нужен PNG, JPG или WebP");
  }
  if (!ext) throw new Error("Нужна картинка PNG, JPG, WebP, SVG или ICO");
  if (file.size > 2_097_152) throw new Error("Файл больше 2 МБ");

  const folder = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "site");
  await mkdir(folder, { recursive: true });
  const filename = `${kind}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  await writeFile(path.join(folder, filename), Buffer.from(await file.arrayBuffer()));
  return `/uploads/site/${filename}`;
}
