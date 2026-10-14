/** Dollar amount without rounding to cents. Keeps up to 8 decimal places. */
export function formatExact(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00";
  const negative = amount < 0;
  const text = Math.abs(amount).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  const [whole, frac = ""] = text.split(".");
  const cents = frac.length >= 2 ? frac : frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0";
  return `$${formatExact(amount)}`;
}
