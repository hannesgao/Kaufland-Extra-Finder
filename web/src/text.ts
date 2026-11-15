/** Lower case without accents, so "muenchen"/"münchen" style input still finds something. */
export function normalize(text: string): string {
  return text.toLocaleLowerCase("de").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
}
