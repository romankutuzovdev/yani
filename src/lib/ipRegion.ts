import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type IpPlace = {
  country: string;
  region: string;
  label: string;
};

const UNKNOWN: IpPlace = { country: "Не определено", region: "", label: "Не определено" };
const LOCAL: IpPlace = { country: "Локальная сеть", region: "", label: "Локальная сеть" };

const memory = new Map<string, IpPlace>();
let loaded = false;
let writing: Promise<void> = Promise.resolve();

function cacheFile() {
  return path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "ip-regions.json");
}

function isPrivate(ip: string) {
  const value = ip.trim().toLowerCase();
  if (!value || value === "неизвестно" || value === "unknown") return true;
  if (value === "::1" || value.startsWith("127.") || value.startsWith("0.")) return true;
  if (value.startsWith("10.") || value.startsWith("192.168.") || value.startsWith("169.254.")) return true;
  const v4 = value.match(/^172\.(\d+)\./);
  if (v4) {
    const n = Number(v4[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80")) return true;
  return false;
}

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(await readFile(cacheFile(), "utf8")) as Record<string, IpPlace>;
    for (const [ip, place] of Object.entries(raw)) {
      if (place?.label) memory.set(ip, place);
    }
  } catch {
    /* first run */
  }
}

function persist() {
  const data = Object.fromEntries(memory);
  writing = writing.then(async () => {
    const file = cacheFile();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  }).catch(() => undefined);
}

function countryName(code: string, fallback: string) {
  const iso = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return fallback || UNKNOWN.country;
  try {
    return new Intl.DisplayNames(["ru"], { type: "region" }).of(iso) || fallback || iso;
  } catch {
    return fallback || iso;
  }
}

async function lookup(ip: string): Promise<IpPlace> {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) return UNKNOWN;
  const data = (await res.json()) as {
    success?: boolean;
    country?: string;
    country_code?: string;
    region?: string;
  };
  if (!data.success) return UNKNOWN;
  const country = countryName(data.country_code ?? "", data.country ?? "");
  const region = (data.region ?? "").trim();
  const label = region && region.toLowerCase() !== country.toLowerCase() ? `${country}, ${region}` : country;
  return { country, region, label };
}

/** Country and region for public IPs. Results are cached on disk. */
export async function placesForIps(ips: string[]): Promise<Map<string, IpPlace>> {
  await loadCache();
  const unique = [...new Set(ips.map((ip) => ip.trim()).filter(Boolean))];
  const pending: string[] = [];
  for (const ip of unique) {
    if (memory.has(ip)) continue;
    if (isPrivate(ip)) {
      memory.set(ip, LOCAL);
      continue;
    }
    pending.push(ip);
  }

  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const ip = pending[cursor];
      cursor += 1;
      try {
        const place = await lookup(ip);
        if (place !== UNKNOWN && place.label !== UNKNOWN.label) memory.set(ip, place);
      } catch {
        /* retry next time */
      }
    }
  }
  if (pending.length) {
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, () => worker()));
    persist();
  }

  const out = new Map<string, IpPlace>();
  for (const ip of unique) out.set(ip, memory.get(ip) ?? UNKNOWN);
  return out;
}
