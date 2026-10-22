/**
 * A cafe's monogram: the one or two letters that stand in for its logo when it
 * has none, in the header, on the QR cards and in the app icons.
 *
 * The first letter of each of the first two words, skipping a leading "The",
 * "A" or "An" and anything that is not a word ("&", "·"):
 *
 *   "Mochi & Beans" → "MB", "The Daily Grind" → "DG", "Brew" → "B",
 *   "Café Olé" → "CO", "42 Roasters" → "4R"
 *
 * Accents are dropped, so the letters are always ones the icon generator can
 * draw. A name with no Latin letters or digits keeps its first character
 * ("ちゃや" → "ち"): the page can show it, and the icon generator draws a cup
 * instead.
 */

const SKIPPED = new Set(["the", "a", "an"]);

/** The first character as a reader sees it ("क्षि", not "क"). */
function firstCharacter(text: string): string {
  if (typeof Intl.Segmenter === "function") {
    for (const { segment } of new Intl.Segmenter().segment(text)) {
      return segment;
    }
  }
  return Array.from(text)[0] ?? "";
}

export function monogramOf(name: string): string {
  const plain = name.normalize("NFD").replace(/\p{M}/gu, "");
  const words = plain.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const kept =
    words.length > 1 && SKIPPED.has(words[0].toLowerCase())
      ? words.slice(1)
      : words;
  if (kept.length > 0) {
    return kept
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("");
  }
  const trimmed = name.trim();
  return trimmed ? firstCharacter(trimmed) : "";
}

/** Whether every character of a monogram is one the icon glyphs cover. */
export function isDrawableMonogram(letters: string): boolean {
  return /^[A-Z0-9]{1,2}$/.test(letters);
}
