import type { ReactNode } from 'react'

/** The drawings of the tiles: 16 px, one stroke, in the colour of the text. */
export type SlotIcon = 'sketch' | 'part' | 'scan' | 'project' | 'size' | 'link' | 'rules'

const PATHS: Record<SlotIcon, ReactNode> = {
  sketch: (
    <>
      <path d="m3 13 .6-2.6L11 3l2 2-7.4 7.4z" />
      <path d="m9.5 4.5 2 2" />
    </>
  ),
  part: (
    <>
      <path d="M8 2 13 5v6l-5 3-5-3V5z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  scan: (
    <>
      <path d="m8 2 5.5 3v6L8 14l-5.5-3V5z" />
      <path d="m2.5 5 5.5 3 5.5-3M8 8v6" />
    </>
  ),
  project: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M6.5 12.5h6a1 1 0 0 0 1-1v-6" />
    </>
  ),
  size: (
    <>
      <path d="M2 5v6M14 5v6M2 8h12" />
      <path d="m4.5 6-2.5 2 2.5 2M11.5 6l2.5 2-2.5 2" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.7.7" />
      <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9A2.5 2.5 0 0 0 7 12.5l.7-.7" />
    </>
  ),
  rules: (
    <>
      <path d="M3 4h10M3 8h10M3 12h6" />
    </>
  )
}

export function SlotGlyph({ icon }: { icon: SlotIcon }) {
  return (
    <svg className="slot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[icon]}
    </svg>
  )
}

/** A dashed tile that adds one more to the row of what the person has: its name, and under it a muted line of what it takes. */
export function PicTile({ title, hint, help, disabled, onClick }: { title: string; hint: ReactNode; help?: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pic-tile" disabled={disabled} title={help} onClick={onClick}>
      <span className="pic-tile-title">{title}</span>
      <span className="pic-tile-hint">{hint}</span>
    </button>
  )
}

/**
 * A card of the page of a new project: Sizes I know, Rules, Links and PDFs. It has its name and what it is for, `add` for the
 * quiet button that adds a row, and what is in it. `wide` takes the whole row, under the other cards.
 */
export function Slot({ id, title, hint, add, wide, children }: { id: string; title: string; hint: string; add?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return (
    <section className="slot" data-slot={id} data-wide={wide ? '' : undefined} aria-labelledby={`slot-${id}`}>
      <div className="slot-head">
        <h3 className="slot-title" id={`slot-${id}`}>
          {title}
        </h3>
        <span className="slot-hint">{hint}</span>
        {add && <span className="slot-add">{add}</span>}
      </div>
      {children}
    </section>
  )
}
