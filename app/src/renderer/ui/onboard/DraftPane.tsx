import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PromptPreview } from '../../../shared/bridge'
import { MOST_IMAGES } from '../../../shared/objectName'
import { type Draft, useOnboard } from '../../state/onboard'
import { numbered } from '../numbered'
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

/** One run of the prompt as it is drawn: the person's words, a reference (an outlined chip), or torno's own text. */
export interface Run {
  text: string
  mine: boolean
  chip?: boolean
}

/** A reference in torno's text: a file of `reference/`, another project's folder, and whether a picture is attached. */
const REFERENCE = /\((attached: picture \d+|not attached: read [^)]+)\)|reference\/[A-Za-z0-9._-]*[A-Za-z0-9_-]|\.\.\/[^\s/()]+\//g

/** The runs of one stretch of the prompt: the person's words apart, and in what is torno's the references as chips. */
function runsOf(text: string, words: string[]): Run[] {
  return promptPieces(text, words).flatMap((piece): Run[] => {
    if (piece.mine) return [{ ...piece }]
    const runs: Run[] = []
    let from = 0
    for (const m of piece.text.matchAll(REFERENCE)) {
      if (m.index > from) runs.push({ text: piece.text.slice(from, m.index), mine: false })
      runs.push({ text: m[1] ?? m[0], mine: false, chip: true })
      from = m.index + m[0].length
    }
    if (from < piece.text.length) runs.push({ text: piece.text.slice(from), mine: false })
    return runs
  })
}

/** The prompt in stretches: the lines under "Sizes the person gave:" (`sizes`, drawn in the face of numbers) and the rest. */
export function promptStretches(text: string, words: string[]): Array<{ sizes: boolean; runs: Run[] }> {
  const stretches: Array<{ sizes: boolean; text: string }> = []
  let under = false
  for (const line of text.split(/(?<=\n)/)) {
    const size = under && line.startsWith('- ')
    if (!size) under = line.trimEnd() === 'Sizes the person gave:'
    const last = stretches[stretches.length - 1]
    if (last && last.sizes === size) last.text += line
    else stretches.push({ sizes: size, text: line })
  }
  return stretches.map((s) => ({ sizes: s.sizes, runs: runsOf(s.text, words) }))
}

/** What stands where the person's description will go, while it is empty (#324). */
export const BLANK_DESCRIPTION = 'What you are making, in your words, goes here.'

/**
 * The prompt in two halves around the place of the description: after the opening line and its blank line, as
 * `onboardPrompt` writes it. None when the text has no such place.
 */
export function aroundDescription(text: string): [string, string] | null {
  const at = text.indexOf('\n\n')
  return at < 0 ? null : [text.slice(0, at + 2), text.slice(at + 2)]
}

const draw = (runs: Run[]): ReactNode[] =>
  runs.map((run, n) => (
    <span key={n} className={run.chip ? 'draft-pane-chip' : run.mine ? 'draft-pane-mine' : undefined}>
      {run.text}
    </span>
  ))

/** What is said under a thumbnail: whether Claude Code gets the picture with the prompt. */
export const pictureState = (attached: number | null, hasPicture: boolean): string =>
  attached !== null ? `attached: picture ${attached}` : hasPicture ? `named only: over ${MOST_IMAGES}` : 'named only'

export interface PaneThumb {
  file: string
  url: string
  attached: number | null
  hasPicture: boolean
}

/** What the page will make: the folder, the model's file, what is in `reference/` and how many scans are imported; or, when it cannot yet, what is missing. */
export type Make = { folder: string; module: string; files: number; scans: number } | string

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function Will({ make }: { make: Make }) {
  if (typeof make === 'string') return <p className="new-will">{make}</p>
  return (
    <p className="new-will">
      Makes <span className="num">{make.folder}</span> with <span className="num">{make.module}.py</span> (a placeholder to be replaced), <span className="num">brief.md</span>
      {make.files > 0 && (
        <>
          {' '}
          and <span className="num">reference/</span> ({numbered(plural(make.files, 'file', 'files'))})
        </>
      )}
      , and lays what you gave out on its board.
      {make.scans > 0 && <> {make.scans === 1 ? 'The scan is' : 'The scans are'} imported into the project, not copied.</>}
    </p>
  )
}

/**
 * The page of a new project's right side, on the dye: the first prompt Claude Code will get once the project is made, read-only,
 * and at its foot what will be made and `children` (the choice of model and the buttons that make it). It is the plate of the
 * page: layout blue, with `--on-dye` text.
 */
export function DraftPane({ preview, words, thumbs, make, blank = false, children }: { preview: PromptPreview | null; words: string[]; thumbs: PaneThumb[]; make: Make; /** The draft has no description yet: a muted line stands in its place. */ blank?: boolean; children?: ReactNode }) {
  const stretches = (text: string, from: number): ReactNode[] =>
    promptStretches(text, words).map((stretch, n) =>
      stretch.sizes ? (
        <span key={from + n} className="draft-pane-size num">
          {draw(stretch.runs)}
        </span>
      ) : (
        <span key={from + n}>{draw(stretch.runs)}</span>
      )
    )
  const halves = preview && blank ? aroundDescription(preview.text) : null
  return (
    <aside className="draft-pane" data-plate aria-label="The first prompt">
      <h3 className="draft-pane-lead">What Claude gets first</h3>
      <p className="draft-pane-sub">Written from this page as you add to it.</p>
      {preview === null ? (
        <p className="draft-pane-none">Reading the prompt…</p>
      ) : (
        <div className="draft-pane-text" tabIndex={0} aria-label="The first prompt">
          {halves ? (
            <>
              {stretches(halves[0], 0)}
              <span className="draft-pane-blank">{BLANK_DESCRIPTION}</span>
              {stretches(halves[1], 1000)}
            </>
          ) : (
            stretches(preview.text, 0)
          )}
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
      <div className="draft-pane-foot">
        <Will make={make} />
        {children}
      </div>
    </aside>
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
export function DraftPaneLive({ make, children }: { make: Make; children?: ReactNode }) {
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
  return (
    <DraftPane preview={preview} words={wordsOf(draft)} thumbs={thumbs} make={make} blank={draft.description.trim() === ''}>
      {children}
    </DraftPane>
  )
}
