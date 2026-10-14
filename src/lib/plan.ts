/** Line shown in the organization cabinet. Empty name means the admin did not set a tariff. */
export function formatPlanLine(planName: string, price: number, monthlyLimit: number) {
  const name = planName.trim();
  if (!name) return "";
  const amount = formatPlanPrice(price);
  const limit = monthlyLimit > 0 ? `лимит запросов ${monthlyLimit}` : "без лимита";
  return `${name}: ${amount} в месяц, ${limit}`;
}

export function formatPlanPrice(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0";
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

export function clampPlanPrice(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(Math.min(value, 1_000_000_000) * 100) / 100;
}
