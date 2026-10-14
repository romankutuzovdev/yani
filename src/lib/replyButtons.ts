export type ReplyButton = { label: string; href: string; popup: boolean };

const BUTTON_RE =
  /\[\[кнопка:\s*([^|\]]+?)\s*\|\s*(https?:\/\/[^\]|\s]+)(?:\s*\|\s*([^\]|\s]+))?\s*\]\]/gi;

const POPUP_WORDS = new Set(["попап", "popup", "окно", "модалка", "modal"]);

function isPopupFlag(flag: string | undefined): boolean {
  return POPUP_WORDS.has((flag || "").trim().toLowerCase());
}

/** Pulls [[кнопка:Подпись|https://…]] and [[кнопка:Подпись|https://…|попап]] out of a model reply. */
export function splitReplyButtons(raw: string): { text: string; buttons: ReplyButton[] } {
  const buttons: ReplyButton[] = [];
  const text = raw
    .replace(BUTTON_RE, (_match, label: string, href: string, flag?: string) => {
      const name = label.trim();
      if (!name || !/^https?:\/\//i.test(href)) return _match;
      buttons.push({ label: name, href, popup: isPopupFlag(flag) });
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
