export const RICH_TEXT_PREFIX = "<!--talora-rich-text-v1-->";

export function isRichTextValue(value: string | null | undefined) {
  return Boolean(value?.startsWith(RICH_TEXT_PREFIX));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function richTextValueToHtml(value: string | null | undefined) {
  if (!value) return "";

  if (isRichTextValue(value)) {
    return value.slice(RICH_TEXT_PREFIX.length);
  }

  return escapeHtml(value).replace(/\r\n?|\n/g, "<br />");
}

export function serializeRichTextHtml(html: string) {
  const visibleText = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, "x")
    .trim();

  return visibleText ? `${RICH_TEXT_PREFIX}${html}` : "";
}
