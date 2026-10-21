/**
 * Local end-to-end smoke test for CRM phases 1–7.
 * Creates temporary playbook data and deletes it at the end.
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { buildImportPreview, isQuietHour, parseImportFile, renderCampaignTemplate } from "../src/lib/crmImport";
import { extractContactsFromText, classifyLeadStage } from "../src/lib/crmAutomation";
import { encryptCrmSecret, decryptCrmSecret } from "../src/lib/crmSecrets";
import { processCampaignQueue } from "../src/lib/crmCampaign";
import { runCrmRecovery } from "../src/lib/crmRecovery";
import { getCrmHealth } from "../src/lib/crmHealth";

const prisma = new PrismaClient();
const base = process.env.CRM_SMOKE_BASE ?? "http://127.0.0.1:3000";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function ok(name: string, pass: boolean, detail?: string) {
  checks.push({ name, ok: pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function authCookie() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Нет ADMIN пользователя");
  const token = await new SignJWT({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  return { admin, cookie: `yani_session=${token}` };
}

async function api(cookie: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log(`\nCRM smoke @ ${base}\n`);

  // Unit helpers
  const extracted = extractContactsFromText(
    "Меня зовут Ольга, компания SmokeLab, email olga@smoke.test, Telegram @olga_smoke. Хочу заказать.",
  );
  ok(
    "P5 extract contacts",
    extracted.some((f) => f.field === "email" && f.value === "olga@smoke.test") &&
      extracted.some((f) => f.field === "telegram" && f.value === "@olga_smoke") &&
      classifyLeadStage("Хочу заказать", "COMMUNICATING") === "READY_TO_ORDER",
  );
  ok(
    "P6 csv parse + dupes",
    (() => {
      const rows = parseImportFile(
        Buffer.from("displayName,email\nA,a@t.by\nB,a@t.by\n"),
        "t.csv",
      );
      const preview = buildImportPreview(rows, []);
      return preview.filter((r) => r.status === "OK").length === 1 && preview.some((r) => r.status === "DUPLICATE");
    })(),
  );
  ok(
    "P6 quiet hours + template",
    isQuietHour(new Date("2026-10-21T23:00:00Z"), "UTC", 22, 8) &&
      renderCampaignTemplate("Hi {{name}}", {
        displayName: "Ольга",
        company: "",
        email: "",
        phone: "",
        telegram: "",
      }) === "Hi Ольга",
  );
  ok("P7 secrets aes-gcm", decryptCrmSecret(encryptCrmSecret("tokensecret")) === "tokensecret");

  const { admin, cookie } = await authCookie();
  const agent = await prisma.agent.findFirst({ where: { enabled: true }, orderBy: [{ isPrimary: "desc" }] });
  if (!agent) throw new Error("Нет агента");

  let playbookId = "";
  try {
    // Phase 1 — playbook + lead + dedupe + message
    const pb = await api(cookie, "/api/crm/playbooks", {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        name: `Smoke ${Date.now()}`,
        product: "Yani CRM",
        sendMode: "APPROVAL_REQUIRED",
        status: "RUNNING",
      }),
    });
    playbookId = pb.data.playbook?.id ?? "";
    ok("P1 create playbook", pb.status === 201 && !!playbookId);

    await api(cookie, `/api/crm/playbooks/${playbookId}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, status: "RUNNING", sendMode: "APPROVAL_REQUIRED" }),
    });

    const leadEmail = `smoke1-${Date.now()}@test.by`;
    const lead1 = await api(cookie, "/api/crm/leads", {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        playbookId,
        displayName: "Клиент 1",
        email: leadEmail,
      }),
    });
    const leadId = lead1.data.lead?.id as string;
    ok("P1 create lead", lead1.status === 201 && !!leadId);

    const dup = await api(cookie, "/api/crm/leads", {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        playbookId,
        displayName: "Дубль",
        email: leadEmail,
      }),
    });
    ok("P1 dedupe email", dup.status === 409);

    // Empty card for auto-extraction (automation fills only blank fields)
    const lead2 = await api(cookie, "/api/crm/leads", {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        playbookId,
        displayName: "",
      }),
    });
    const autoLeadId = lead2.data.lead?.id as string;
    ok("P1 empty lead for auto-fill", lead2.status === 201 && !!autoLeadId);

    const stage = await api(cookie, `/api/crm/leads/${leadId}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, stage: "COMMUNICATING" }),
    });
    ok("P1 stage change", stage.status === 200 && stage.data.lead?.stage === "COMMUNICATING");

    const inbound = await api(cookie, `/api/crm/leads/${autoLeadId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        direction: "INBOUND",
        channel: "MANUAL",
        body: "Меня зовут Ольга Смоук, компания SmokeLab, olga.auto@smoke.test, @olga_auto. Хочу заказать внедрение.",
      }),
    });
    ok("P1 inbound message", inbound.status === 201);

    const opened = await api(cookie, `/api/crm/leads/${autoLeadId}?agentId=${agent.id}`);
    const card = opened.data.lead;
    ok(
      "P5 auto-fill card + stage",
      !!card &&
        card.email === "olga.auto@smoke.test" &&
        String(card.company || "").toLowerCase().includes("smokelab") &&
        card.telegram === "@olga_auto" &&
        card.stage === "READY_TO_ORDER" &&
        (card.fieldChanges?.length ?? 0) >= 3,
      `stage=${card?.stage} email=${card?.email} company=${card?.company} tg=${card?.telegram} changes=${card?.fieldChanges?.length}`,
    );

    const takeover = await api(cookie, `/api/crm/leads/${autoLeadId}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, agentPaused: true }),
    });
    ok("P5 takeover", takeover.status === 200 && takeover.data.lead?.agentPaused === true);
    await api(cookie, `/api/crm/leads/${autoLeadId}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, agentPaused: false }),
    });

    // Fake email connection for campaigns / outbox
    await prisma.crmChannelConnection.upsert({
      where: { playbookId_type: { playbookId, type: "EMAIL" } },
      create: {
        playbookId,
        type: "EMAIL",
        status: "CONNECTED",
        config: JSON.stringify({
          email: "sales@example.com",
          username: "sales@example.com",
          imapHost: "localhost",
          imapPort: 993,
          imapSecure: true,
          smtpHost: "localhost",
          smtpPort: 465,
          smtpSecure: true,
          fromName: "Sales",
          signature: "Yani",
        }),
        encryptedSecret: encryptCrmSecret(JSON.stringify({ password: "x" })),
      },
      update: { status: "CONNECTED" },
    });
    ok("P4 email connection stub", true);

    // Phase 6 import + campaign
    const csv = `displayName,company,email,phone,telegram,notes\nИмпорт А,Фирма,imp.a.${Date.now()}@test.by,+375291110022,@imp_a,note\nИмпорт B,Фирма,imp.a.${Date.now()}@test.by,,,dup\n`;
    // Fix: both rows had same email due to Date.now() twice being same - use fixed stamp
    const stamp = Date.now();
    const csvFixed = `displayName,company,email,phone,telegram,notes\nИмпорт А,Фирма,imp.a.${stamp}@test.by,+375291110022,@imp_a,note\nИмпорт B,Фирма,imp.a.${stamp}@test.by,,,dup\n`;
    const form = new FormData();
    form.set("agentId", agent.id);
    form.set("file", new Blob([csvFixed], { type: "text/csv" }), "smoke.csv");
    const preview = await api(cookie, `/api/crm/playbooks/${playbookId}/import`, {
      method: "POST",
      body: form,
    });
    ok(
      "P6 import preview",
      preview.status === 201 &&
        preview.data.job?.validRows === 1 &&
        preview.data.job?.duplicateCount === 1,
      JSON.stringify({
        status: preview.status,
        valid: preview.data.job?.validRows,
        dup: preview.data.job?.duplicateCount,
        err: preview.data.error,
      }),
    );

    const confirm = await api(cookie, `/api/crm/playbooks/${playbookId}/import`, {
      method: "POST",
      body: JSON.stringify({ agentId: agent.id, jobId: preview.data.job.id }),
    });
    ok("P6 import apply", confirm.status === 200 && confirm.data.createdCount === 1);

    const campaign = await api(cookie, `/api/crm/playbooks/${playbookId}/campaigns`, {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        name: "Smoke first emails",
        subject: "Привет {{name}}",
        bodyTemplate: "Коллеги из {{company}}, это Yani smoke-тест.",
        dailyLimit: 10,
        intervalSeconds: 10,
        quietHoursStart: null,
        quietHoursEnd: null,
        importJobId: confirm.data.job.id,
      }),
    });
    ok("P6 create campaign", campaign.status === 201, campaign.data.error);

    const start = await api(cookie, `/api/crm/campaigns/${campaign.data.campaign.id}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, action: "START" }),
    });
    ok("P6 start campaign", start.status === 200 && start.data.campaign?.status === "RUNNING");

    await processCampaignQueue(new Date());
    const items = await prisma.crmCampaignItem.findMany({
      where: { campaignId: campaign.data.campaign.id },
    });
    ok("P6 campaign queued outbox", items.some((i) => i.status === "SENT"), items.map((i) => i.status).join(","));

    const stop = await api(cookie, `/api/crm/campaigns/${campaign.data.campaign.id}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, action: "STOP" }),
    });
    ok("P6 stop campaign", stop.status === 200 && stop.data.campaign?.status === "STOPPED");

    // Phase 7 health + recovery + audit
    const healthApi = await api(cookie, `/api/crm/health?agentId=${agent.id}&playbookId=${playbookId}`);
    ok(
      "P7 health api",
      healthApi.status === 200 &&
        !!healthApi.data.health?.queues &&
        (healthApi.data.health.status === "ok" || healthApi.data.health.status === "degraded"),
    );
    const healthLib = await getCrmHealth();
    ok("P7 health lib", !!healthLib.queues);

    const recovery = await runCrmRecovery();
    ok("P7 recovery runs", typeof recovery.reclaimed === "number");

    const audits = await prisma.crmAuditEvent.count({ where: { playbookId } });
    ok("P7 audit events", audits >= 2, `count=${audits}`);

    // sendMode DRAFT_ONLY blocks approve
    await api(cookie, `/api/crm/playbooks/${playbookId}`, {
      method: "PUT",
      body: JSON.stringify({ agentId: agent.id, sendMode: "DRAFT_ONLY" }),
    });
    const draftMsg = await api(cookie, `/api/crm/leads/${leadId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        agentId: agent.id,
        direction: "OUTBOUND",
        channel: "EMAIL",
        body: "Черновик без отправки",
      }),
    });
    const messageId = draftMsg.data.message?.id as string | undefined;
    if (messageId) {
      const approve = await api(cookie, `/api/crm/messages/${messageId}/outbox`, {
        method: "PUT",
        body: JSON.stringify({ agentId: agent.id, action: "APPROVE" }),
      });
      ok("P5 DRAFT_ONLY blocks approve", approve.status >= 400, `status=${approve.status}`);
    } else {
      ok("P5 DRAFT_ONLY blocks approve", false, "no outbox message");
    }

    const page = await fetch(`${base}/admin/crm`, { redirect: "manual", headers: { cookie } });
    ok("UI /admin/crm reachable", page.status === 200 || page.status === 307 || page.status === 302);

    void admin;
    void csv;
  } finally {
    if (playbookId) {
      await api(cookie, `/api/crm/playbooks/${playbookId}`, {
        method: "DELETE",
        body: JSON.stringify({ agentId: agent.id }),
      }).catch(() => undefined);
      await prisma.salesPlaybook.deleteMany({ where: { id: playbookId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nИтого: ${checks.length - failed.length}/${checks.length} OK`);
  if (failed.length) {
    console.log("Провалы:");
    for (const item of failed) console.log(` - ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch(async (cause) => {
  console.error(cause);
  await prisma.$disconnect();
  process.exit(1);
});
