import type { ReactNode } from 'react'
import { numbered } from './numbered'

/** The words of a find, as `findParams` reads them: lower case, split on spaces. */
export const wordsOf = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * A text with every place a word of the find was found marked (any case), the rest as `plain` makes it. Overlapping
 * words are marked once, as one run.
 */
export function markWords(text: string, words: readonly string[], plain: (piece: string) => ReactNode = (piece) => piece): ReactNode[] {
  if (words.length === 0) return [plain(text)]
  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const word of words) {
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) marked.fill(true, at, at + word.length)
  }
  const out: ReactNode[] = []
  for (let start = 0, key = 0; start < text.length; key += 1) {
    let end = start
    while (end < text.length && marked[end] === marked[start]) end += 1
    const piece = text.slice(start, end)
    out.push(marked[start] ? <mark key={key}>{piece}</mark> : <span key={key}>{plain(piece)}</span>)
    start = end
  }
  return out
}

/** A comment with its numbers in the monospace face and the words of the find marked. */
export const markNumbered = (text: string, words: readonly string[]): ReactNode[] => markWords(text, words, numbered)
