import { useEffect, useRef, useState } from 'react'
import type { PromptPreview } from '../../../shared/bridge'
import { MOST_IMAGES } from '../../../shared/objectName'
import { type Draft, useOnboard } from '../../state/onboard'
import { previewDraft } from './make'

/** The text in pieces, those that are the person's own words (`mine`) and those torno wrote around them. */
export function promptPieces(text: string, words: string[]): Array<{ text: string; mine: boolean }> {
  const found = [...new Set(words.map((w) => w.trim()).filter((w) => w !== ''))].sort((a, b) => b.length - a.length)
  if (found.length === 0) return [{ text, mine: false }]
  const pieces: Array<{ text: string; mine: boolean }> = []
  let from = 0
  while (from < text.length) {
    let at = -1
    let word = ''
    for (const w of found) {
      const i = text.indexOf(w, from)
      if (i !== -1 && (at === -1 || i < at)) (at = i), (word = w)
    }
    if (at === -1) break
    if (at > from) pieces.push({ text: text.slice(from, at), mine: false })
    pieces.push({ text: word, mine: true })
    from = at + word.length
  }
  if (from < text.length) pieces.push({ text: text.slice(from), mine: false })
  return pieces
}

/** What is said under a thumbnail: whether Claude Code gets the picture with the prompt. */
export const pictureState = (attached: number | null, hasPicture: boolean): string =>
  attached !== null ? `attached: picture ${attached}` : hasPicture ? `named only: over ${MOST_IMAGES}` : 'named only'

export interface PaneThumb {
  file: string
  url: string
  attached: number | null
  hasPicture: boolean
}

/** The session pane while a new object is made: the first prompt Claude Code will get once it is created, read-only. */
export function DraftPane({ preview, words, thumbs }: { preview: PromptPreview | null; words: string[]; thumbs: PaneThumb[] }) {
  return (
    <div className="draft-pane" role="note">
      <h3 className="draft-pane-lead">What Claude gets first</h3>
      <p className="draft-pane-sub">Written from the board, updates as you add.</p>
      {preview === null ? (
        <p className="draft-pane-none">Reading the prompt…</p>
      ) : (
        <div className="draft-pane-text" tabIndex={0} aria-label="The first prompt">
          {promptPieces(preview.text, words).map((piece, n) => (
            <span key={n} className={piece.mine ? 'draft-pane-mine' : undefined}>
              {piece.text}
            </span>
          ))}
        </div>
      )}
      {thumbs.length > 0 && (
        <ul className="draft-pane-pictures" aria-label="Pictures">
          {thumbs.map((t) => (
            <li key={t.file}>
              <img src={t.url} alt="" />
              <span className="num">{t.file.replace('reference/', '')}</span>
              <span className="draft-pane-state">{pictureState(t.attached, t.hasPicture)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The person's own words in a draft, which the prompt carries as they were written. */
export const wordsOf = (d: Draft): string[] => [
  d.description,
  d.rules,
  ...d.photos.map((p) => p.note),
  ...d.doodles.map((x) => x.note),
  ...d.steps.map((s) => s.note),
  ...d.scans.map((s) => s.note),
  ...d.objects.map((o) => o.note),
  ...d.sizes.flatMap((s) => [s.what, s.note]),
  ...d.links.flatMap((l) => [l.url, l.note]),
  ...d.pdfs.map((p) => p.note)
]

/** The same, of the draft being made: asked of main again 300 ms after each change. */
export function DraftPaneLive() {
  const draft = useOnboard((s) => s.draft)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const asked = useRef(0)
  useEffect(() => {
    const mine = ++asked.current
    const timer = setTimeout(() => {
      window.torno.objects.previewPrompt(draft.name, previewDraft(draft)).then(
        (p) => mine === asked.current && setPreview(p),
        () => {}
      )
    }, 300)
    return () => clearTimeout(timer)
  }, [draft])
  const files = previewDraft(draft).items
  const urls = [...draft.photos.map((p) => p.url), ...draft.doodles.map((d) => d.url)]
  const thumbs = files.map((f, i): PaneThumb => ({ file: f.file, url: urls[i], attached: preview?.attached[i] ?? null, hasPicture: f.picture }))
  return <DraftPane preview={preview} words={wordsOf(draft)} thumbs={thumbs} />
}
