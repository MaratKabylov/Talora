import "server-only";

import sanitizeHtml from "sanitize-html";

import { isRichTextValue, RICH_TEXT_PREFIX } from "@/lib/rich-text";

const FONT_SIZES = new Set(["2", "3", "4", "5", "6"]);

export function sanitizeRichTextValue(value: string | null | undefined) {
  const normalized = value ?? "";
  if (!normalized.trim()) return null;

  if (!isRichTextValue(normalized)) {
    return normalized;
  }

  const sanitized = sanitizeHtml(normalized.slice(RICH_TEXT_PREFIX.length), {
    allowedAttributes: {
      blockquote: [],
      br: [],
      div: ["style"],
      h2: [],
      h3: [],
      li: [],
      ol: [],
      p: ["style"],
      span: ["data-size"],
      ul: [],
    },
    allowedStyles: {
      div: { "text-align": [/^(left|center|right)$/] },
      p: { "text-align": [/^(left|center|right)$/] },
    },
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "h2",
      "h3",
      "blockquote",
      "div",
      "span",
      "font",
    ],
    transformTags: {
      font: (_tagName, attributes) => ({
        attribs: { "data-size": FONT_SIZES.has(attributes.size) ? attributes.size : "3" },
        tagName: "span",
      }),
    },
  });
  const visibleText = sanitizeHtml(sanitized, { allowedAttributes: {}, allowedTags: [] })
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();

  return visibleText ? `${RICH_TEXT_PREFIX}${sanitized}` : null;
}
