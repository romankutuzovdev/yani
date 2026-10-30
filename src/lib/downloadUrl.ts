/** Build `/uploads/...` URL that forces browser download with a friendly name. */
export function fileDownloadUrl(fileUrl: string, fileName?: string) {
  const base = (fileUrl || "").trim();
  if (!base) return "#";
  const params = new URLSearchParams({ download: "1" });
  const name = (fileName || "").trim();
  if (name) params.set("name", name);
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}${params.toString()}`;
}
