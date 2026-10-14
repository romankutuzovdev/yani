import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";
import { resolveSiteFavicon } from "@/lib/siteSeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  noStore();
  const favicon = await resolveSiteFavicon();
  if (!favicon) return new NextResponse(null, { status: 404 });

  let size = 0;
  try {
    size = (await stat(favicon.filePath)).size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  if (size <= 0) return new NextResponse(null, { status: 404 });

  const stream = Readable.toWeb(createReadStream(favicon.filePath)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": favicon.type,
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
