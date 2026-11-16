import { useEffect, useRef, useState, type ReactNode } from 'react'
import { pressed, which } from '../../../shared/keys'
import { count } from '../../../shared/format'
import { onboarding, type Draft, type Kind } from '../../state/onboard'
import { giveKeysBack } from '../typing'
import { Logo } from '../Logo'

/** The longest note a card takes (main folds it to one line and takes up to 2000). */
const NOTE_MAX = 500

/** A file size as a person reads it: kilobytes up to a megabyte, then megabytes. */
export function sizeSaid(bytes: number): string {
  return bytes < 1024 * 1024 ? `${count(Math.max(1, Math.round(bytes / 1024)))} KB` : `${count(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`
}

/** The picture an object has on file, as an object URL; null while it is asked for or when there is none. */
function useObjectPicture(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let made: string | null = null
    window.torno.show.thumbnail(id).then(
      (png) => {
        if (!live || !png) return
        made = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
        setUrl(made)
      },
      () => {}
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [id])
  return url
}

function Note({ kind, itemKey, value, label }: { kind: Kind; itemKey: string; value: string; label: string }) {
  return (
    <input
      className="ref-note"
      type="text"
      value={value}
      maxLength={NOTE_MAX}
      placeholder="Note for Claude"
      aria-label={label}
      spellCheck
      autoComplete="off"
      onChange={(e) => onboarding.setNote(kind, itemKey, e.target.value)}
      onKeyDown={(e) => {
        // Enter keeps what was typed and gives the keys back to the page, as every field does.
        if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
      }}
    />
  )
}

function Card({ kind, word, itemKey, file, detail, note, thumb, onEdit, name }: { kind: Kind; word: string; itemKey: string; file: string; detail?: string; note: string; thumb: ReactNode; onEdit?: () => void; name: string }) {
  return (
    <li className="ref-card" data-kind={kind} aria-label={`${word} ${name}`}>
      <div className="ref-thumb">{thumb}</div>
      <div className="ref-body">
        <p className="ref-head">
          <span className="ref-kind">{word}</span>
          <span className="ref-file num" title={file}>
            {file}
          </span>
          {detail && <span className="ref-detail num">{detail}</span>}
        </p>
        <Note kind={kind} itemKey={itemKey} value={note} label={`Note for ${word.toLowerCase()} ${file}`} />
      </div>
      <div className="ref-actions">
        {onEdit && (
          <button type="button" className="button button-quiet" aria-label={`Change ${name}`} onClick={onEdit}>
            Change
          </button>
        )}
        <button type="button" className="button button-quiet" aria-label={`Remove ${name}`} onClick={() => onboarding.remove(kind, itemKey)}>
          Remove
        </button>
      </div>
    </li>
  )
}

function ObjectCard({ id, itemKey, note }: { id: string; itemKey: string; note: string }) {
  const picture = useObjectPicture(id)
  return (
    <Card
      kind="objects"
      word="Project"
      itemKey={itemKey}
      file={id}
      note={note}
      name={id}
      thumb={picture ? <img src={picture} alt="" draggable={false} /> : <Logo plain />}
    />
  )
}

/** The kinds that are cards of files and projects, in the order they are listed in. */
export type CardKind = 'photos' | 'doodles' | 'steps' | 'scans' | 'objects' | 'pdfs'

/** What the person has given of the kinds named (all of them when none are), a card each, in the order of the kinds: photos, doodles, bought parts, scans, objects, PDFs. */
export function ReferenceCards({ draft, kinds, label = 'What you have', onEditDoodle }: { draft: Draft; kinds?: readonly CardKind[]; label?: string; onEditDoodle: (key: string) => void }) {
  const has = (kind: CardKind): boolean => kinds === undefined || kinds.includes(kind)
  return (
    <ul className="ref-list" aria-label={label}>
      {has('photos') && draft.photos.map((p, n) => (
        <Card key={p.uid} kind="photos" word="Photo" itemKey={p.uid} file={p.file} detail={p.detail} note={p.note} name={`photo ${n + 1}`} thumb={<img src={p.url} alt="" draggable={false} />} />
      ))}
      {has('doodles') && draft.doodles.map((d, n) => (
        <Card key={d.uid} kind="doodles" word="Doodle" itemKey={d.uid} file={`doodle-${n + 1}.png`} note={d.note} name={`doodle ${n + 1}`} thumb={<img src={d.url} alt="" draggable={false} />} onEdit={() => onEditDoodle(d.uid)} />
      ))}
      {has('steps') && draft.steps.map((s, n) => (
        <Card
          key={s.uid}
          kind="steps"
          word="Bought part"
          itemKey={s.uid}
          file={s.file}
          detail={s.size === undefined ? undefined : sizeSaid(s.size)}
          note={s.note}
          name={`bought part ${n + 1}`}
          thumb={
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 4 26 10v12l-10 6-10-6V10z" />
              <circle cx="16" cy="16" r="4" />
            </svg>
          }
        />
      ))}
      {has('scans') && draft.scans.map((s, n) => (
        <Card
          key={s.uid}
          kind="scans"
          word="Scan"
          itemKey={s.uid}
          file={s.file}
          detail={s.size === undefined ? undefined : sizeSaid(s.size)}
          note={s.note}
          name={`scan ${n + 1}`}
          thumb={
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true">
              <path d="m16 4 11 6v12l-11 6-11-6V10z" />
              <path d="m5 10 11 6 11-6M16 16v12" />
            </svg>
          }
        />
      ))}
      {has('objects') && draft.objects.map((o) => <ObjectCard key={o.uid} id={o.id} itemKey={o.uid} note={o.note} />)}
      {has('pdfs') &&
        draft.pdfs.map((p, n) => (
          <Card
            key={p.uid}
            kind="pdfs"
            word="PDF"
            itemKey={p.uid}
            file={p.file}
            detail={p.size === undefined ? undefined : sizeSaid(p.size)}
            note={p.note}
            name={`PDF ${n + 1}`}
            thumb={
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 4h10l5 5v19H9z" />
                <path d="M19 4v5h5M12 16h9M12 20h9M12 24h5" />
              </svg>
            }
          />
        ))}
    </ul>
  )
}

/** A button and the list of the workspace's objects under it, each with the picture it has: the one to refer to is chosen from it. */
export function ObjectMenu({ ids, disabled, onChoose, className = 'button', label, children = 'Refer to a project…' }: { ids: string[]; disabled: boolean; onChoose: (id: string) => void; className?: string; label?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const close = (back: boolean): void => {
    setOpen(false)
    if (back) button.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    holder.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    // A press elsewhere puts the menu away.
    const away = (e: PointerEvent): void => {
      if (e.target instanceof Node && !holder.current?.contains(e.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open])

  return (
    <div className="ref-menu" ref={holder}>
      <button ref={button} type="button" className={className} disabled={disabled || ids.length === 0} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={ids.length === 0 ? 'No other project here to refer to' : undefined} onClick={() => setOpen((was) => !was)}>
        {children}
      </button>
      {open && (
        <ul
          className="ref-menu-list"
          role="menu"
          aria-label="Projects of this workspace"
          onKeyDown={(e) => {
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            const at = items.indexOf(document.activeElement as HTMLElement)
            const move = (to: number): void => {
              e.preventDefault()
              items[(to + items.length) % items.length]?.focus()
            }
            if (pressed(e, 'menu.next')) move(at + 1)
            else if (pressed(e, 'menu.previous')) move(at - 1)
            else if (pressed(e, 'menu.ends')) move(which(e, 'menu.ends') === 0 ? 0 : items.length - 1)
            else if (pressed(e, 'menu.close')) {
              e.preventDefault()
              e.stopPropagation()
              close(true)
            }
          }}
        >
          {ids.map((id) => (
            <li key={id} role="none">
              <MenuItem
                id={id}
                onChoose={() => {
                  close(true)
                  onChoose(id)
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MenuItem({ id, onChoose }: { id: string; onChoose: () => void }) {
  const picture = useObjectPicture(id)
  return (
    <button type="button" role="menuitem" className="ref-menu-item" onClick={onChoose}>
      <span className="ref-menu-thumb">{picture ? <img src={picture} alt="" draggable={false} /> : <Logo small plain />}</span>
      <span className="ref-menu-name num">{id}</span>
    </button>
  )
}
