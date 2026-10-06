/**
 * What the PNG and PDF exports share: the palette (also used by the HTML export) and line
 * wrapping with a caller-supplied text measure (canvas pixels or PDF points).
 */

export const PALETTE = {
  accent: "#1f3a68",
  text: "#1b1f24",
  muted: "#4a5361",
  zebra: "#f2f5fa",
  rule: "#dfe5ee",
  onAccent: "#ffffff",
} as const;

/** Width of a text at the size the caller lays out with. */
export type Measure = (text: string) => number;

/** Hard-break a single word that is wider than the line. */
function breakWord(word: string, maxWidth: number, measure: Measure): string[] {
  const parts: string[] = [];
  let part = "";
  for (const char of word) {
    if (part && measure(part + char) > maxWidth) {
      parts.push(part);
      part = char;
    } else {
      part += char;
    }
  }
  if (part) parts.push(part);
  return parts;
}

/** Greedy word wrap; words wider than a line are broken by character. Never returns []. */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    const pieces = measure(word) > maxWidth ? breakWord(word, maxWidth, measure) : [word];
    line = pieces.pop() ?? "";
    lines.push(...pieces);
  }
  lines.push(line);
  return lines;
}

/** "#1f3a68" -> [0.12, 0.23, 0.41] */
export function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
}
