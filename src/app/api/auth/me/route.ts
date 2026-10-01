import { getSession } from "@/lib/auth";
import { error, json } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return error("Unauthorized", 401);
  return json({ user: session });
}
