export type ReplyButton = { label: string; href: string };

const BUTTON_RE = /\[\[кнопка:\s*([^|\]]+?)\s*\|\s*(https?:\/\/[^\]\s]+)\s*\]\]/gi;

/** Pulls [[кнопка:Подпись|https://…]] out of a model reply. */
export function splitReplyButtons(raw: string): { text: string; buttons: ReplyButton[] } {
  const buttons: ReplyButton[] = [];
  const text = raw
    .replace(BUTTON_RE, (_match, label: string, href: string) => {
      const name = label.trim();
      if (!name || !/^https?:\/\//i.test(href)) return _match;
      buttons.push({ label: name, href });
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, buttons };
}

/** Hides a button token that is still arriving in the stream. */
export function hideOpenButtonToken(raw: string): string {
  return raw.replace(/\[\[кнопка:[^\]]*$/i, "");
}
