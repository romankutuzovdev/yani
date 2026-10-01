import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

type Params = { params: Promise<{ path: string[] }> };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
};

export async function GET(_req: NextRequest, { params }: Params) {
  const { path: parts } = await params;
  const safe = parts.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, "")).filter(Boolean);
  if (!safe.length || safe.some((p) => p === ".." || p.includes(".."))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "uploads", ...safe);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return new NextResponse(data, {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
