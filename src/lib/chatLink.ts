/** Public chat of one agent. Uses that agent's slug, never a stand-in. */
export function agentChatUrl(slug: string) {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "https://yani.by").replace(/\/$/, "");
  return `${origin}/chat?slug=${encodeURIComponent(slug)}`;
}
