import { NextRequest } from "next/server";
import { ingestInstagramPayload } from "@/lib/crmInstagram";
import { instagramVerifyToken, verifyInstagramSignature } from "@/lib/instagram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === instagramVerifyToken() && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyInstagramSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 403 });
  }
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("bad json", { status: 400 });
  }
  void ingestInstagramPayload(payload).catch((cause) => {
    console.error("[crm-instagram] webhook:", cause instanceof Error ? cause.message : cause);
  });
  return new Response("ok", { status: 200 });
}
