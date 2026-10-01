import { clearSessionCookie, getSession } from "@/lib/auth";
import { json, writeLog } from "@/lib/api";

export async function POST() {
  const session = await getSession();
  await clearSessionCookie();
  if (session) {
    await writeLog({
      type: "auth",
      message: `User logged out: ${session.email}`,
      userId: session.id,
    });
  }
  return json({ ok: true });
}
