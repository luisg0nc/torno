import type { ReactNode } from 'react'
import { numbered } from './numbered'

/**
 * The title of a section of a panel: a word, with what matters of what the section holds beside it when there is
 * something to say (`said`, its numbers in the monospace face), and the one thing to do in the section (`children`:
 * Import scan…, Show all) at its right end. A panel's sections do not fold: the panel is the fold.
 */
export function SectionTitle({ title, said, children }: { title: string; said?: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2 className="section-title">
        {title}
        {said !== undefined && <span className="section-said">{numbered(said)}</span>}
      </h2>
      {children}
    </div>
  )
}
