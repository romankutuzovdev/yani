import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";
import {
  minskDayBounds,
  minskDayKey,
  minskDayLabel,
  startOfMinskDay,
  startOfMinskMonth,
} from "@/lib/minskTime";
import { saveYandexSettings, yandexPublicSettings } from "@/lib/yandexSettings";

function formatRub(amount: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

async function spend(selectedDayKey?: string | null) {
  const day = startOfMinskDay();
  const month = startOfMinskMonth();
  const where = { provider: "yandex" as const, requestType: "yandex_search" };
  const dayKey = selectedDayKey?.trim() || minskDayKey(new Date());
  const bounds = minskDayBounds(dayKey) ?? {
    start: day,
    end: new Date(day.getTime() + 24 * 60 * 60 * 1000),
  };

  const [today, monthRows, all, selected] = await Promise.all([
    prisma.usageRecord.aggregate({
      where: { ...where, createdAt: { gte: day } },
      _sum: { estimatedCost: true },
      _count: true,
    }),
    prisma.usageRecord.aggregate({
      where: { ...where, createdAt: { gte: month } },
      _sum: { estimatedCost: true },
      _count: true,
    }),
    prisma.usageRecord.aggregate({
      where,
      _sum: { estimatedCost: true },
      _count: true,
    }),
    prisma.usageRecord.aggregate({
      where: {
        ...where,
        createdAt: { gte: bounds.start, lt: bounds.end },
      },
      _sum: { estimatedCost: true },
      _count: true,
    }),
  ]);
  const pack = (row: { _sum: { estimatedCost: number | null }; _count: number }) => ({
    rub: row._sum.estimatedCost ?? 0,
    label: formatRub(row._sum.estimatedCost ?? 0),
    requests: row._count,
  });
  return {
    today: pack(today),
    month: pack(monthRows),
    all: pack(all),
    selected: {
      ...pack(selected),
      day: dayKey,
      dayLabel: minskDayLabel(dayKey),
    },
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const day = req.nextUrl.searchParams.get("day");
  return json({ settings: yandexPublicSettings(), spend: await spend(day) });
}

const bodySchema = z.object({
  apiKey: z.string().max(500).optional(),
  folderId: z.string().max(80).optional(),
  dayRubPer1000: z.number().min(0).max(100_000).optional(),
  nightRubPer1000: z.number().min(0).max(100_000).optional(),
  clearKey: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = bodySchema.parse(await req.json());
    const settings = saveYandexSettings(body);
    return json({ settings, spend: await spend() });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте поля");
    return error(cause instanceof Error ? cause.message : "Не удалось сохранить", 500);
  }
}
