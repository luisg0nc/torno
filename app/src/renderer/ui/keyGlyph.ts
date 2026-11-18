/** A key as its cap shows it in a card (spec 2026-11-18): Enter is `↵`. The key itself comes from the table (`hint`). */
export function keyGlyph(key: string): string {
  return key === 'Enter' ? '↵' : key
}
