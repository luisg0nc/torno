import { useState } from 'react'
import { pressed } from '../../../shared/keys'
import { MAX_LINK_NOTE, MAX_URL } from '../../../shared/objectName'
import { onboarding, type Draft } from '../../state/onboard'
import { giveKeysBack } from '../typing'
import { ReferenceCards } from './ReferenceItems'

/** The links given, a row each with its note: kept as text, never opened from here. */
function LinkRow({ url, uid, note, n }: { url: string; uid: string; note: string; n: number }) {
  return (
    <li className="link-row" aria-label={`Link ${n + 1}`}>
      <span className="link-url num" title={url}>
        {url}
      </span>
      <input
        className="ref-note"
        type="text"
        value={note}
        maxLength={MAX_LINK_NOTE}
        placeholder="Note for Claude"
        aria-label={`Note for link ${n + 1}`}
        spellCheck
        autoComplete="off"
        onChange={(e) => onboarding.setNote('links', uid, e.target.value)}
        onKeyDown={(e) => {
          if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
        }}
      />
      <button type="button" className="button button-quiet" aria-label={`Remove link ${n + 1}`} onClick={() => onboarding.remove('links', uid)}>
        Remove
      </button>
    </li>
  )
}

/**
 * The links and PDFs: a link is typed here (an `http` or `https` address, one line, with an optional note under it on its
 * row), a PDF is chosen or dropped. Both are given to Claude with the first prompt; torno reads neither.
 */
export function LinksSlot({ draft, disabled, onAddPdf, onSaid }: { draft: Draft; disabled: boolean; onAddPdf: () => void; onSaid: (why: string | null) => void }) {
  const [url, setUrl] = useState('')
  const add = (): void => {
    if (url.trim() === '') return
    const why = onboarding.addLink(url)
    onSaid(why)
    if (why === null) setUrl('')
  }
  return (
    <>
      <div className="link-add">
        <input
          className="new-input num"
          type="url"
          data-first=""
          aria-label="Link address"
          value={url}
          maxLength={MAX_URL}
          disabled={disabled}
          placeholder="https://"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (pressed(e, 'field.keep')) {
              e.preventDefault()
              if (url.trim() === '') giveKeysBack(e.currentTarget)
              else add()
            }
          }}
        />
        <button type="button" className="button" disabled={disabled || url.trim() === ''} onClick={add}>
          Add link
        </button>
        <button type="button" className="button" disabled={disabled} onClick={onAddPdf}>
          Add a PDF…
        </button>
      </div>
      {draft.links.length > 0 && (
        <ul className="link-list" aria-label="Links">
          {draft.links.map((l, n) => (
            <LinkRow key={l.uid} url={l.url} uid={l.uid} note={l.note} n={n} />
          ))}
        </ul>
      )}
      <ReferenceCards draft={draft} kinds={['pdfs']} label="PDFs" onEditDoodle={() => {}} />
      <p className="new-help">A datasheet, a forum thread. torno does not open a link: Claude reads one with its own tools if it helps. A PDF is copied into reference/.</p>
    </>
  )
}
