import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/AdminShell";

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN") redirect("/admin");
  if (session.role !== "ORG") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      salesEnabled: true,
      orgAgent: { select: { slug: true } },
    },
  });
  const slug = user?.orgAgent?.slug;

  return (
    <AdminShell
      area="org"
      userName={session.name || session.email}
      chatHref={slug ? `/chat?slug=${encodeURIComponent(slug)}` : "/chat"}
      salesEnabled={Boolean(user?.salesEnabled)}
    >
      {children}
    </AdminShell>
  );
}
