import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SalesCrm } from "@/components/SalesCrm";

export default async function OrgCrmPage() {
  const session = await getSession();
  if (!session || session.role !== "ORG") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { salesEnabled: true },
  });
  if (!user?.salesEnabled) redirect("/org");

  return <SalesCrm />;
}
