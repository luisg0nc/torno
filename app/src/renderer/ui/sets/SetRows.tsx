import { useEffect, useRef, useState } from 'react'
import { pressed } from '../../../shared/keys'
import { SET_COLOURS, SET_NAME_MAX, setNameError } from '../../../shared/sets'
import { actions, useStore } from '../../state/store'
import { selectableMembers, setActions, setsStore, useSets } from '../../state/sets'
import { canTag } from '../../state/setTag'
import { giveKeysBack } from '../typing'
import { numbered } from '../numbered'
import { makeTag } from './makeTag'
import { partsOfSet, type SetRow } from './rows'

/** A set's colour as the stylesheet has it: `--set-1` to `--set-8`, so that a theme changes it with no code. */
export const setColourVar = (colour: number): string => `var(--set-${(((colour % SET_COLOURS) + SET_COLOURS) % SET_COLOURS) + 1})`

/**
 * The rows of named sets in Layers: under their part, or under "Named sets" when they span parts. The pointer on a row lights
 * the set in the view in its colour; the name selects its members; "Show only" shows the parts it is in; the rest (rename,
 * colour, add or take away the selection, Re-pick, delete) is under the dots, and a proposal of Claude's has Accept and Dismiss
 * where they are seen, its swatch dashed.
 */
export function SetRowView({ row, layout, indent }: { row: SetRow; layout: string; indent?: boolean }) {
  const repicking = useSets((s) => s.repicking === row.id)
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  // The pointer or the keys' focus on the row lights its set; a row that goes while it does takes the light with it.
  const lit = useRef(false)
  const light = (on: boolean): void => {
    lit.current = on
    setActions.hover(on ? row.id : null)
  }
  useEffect(
    () => () => {
      if (lit.current) setActions.hover(null)
    },
    []
  )
  const selected = useStore((s) => s.selection.length > 0)
  const shown = open || row.proposed || repicking
  const has = (action: SetRow['actions'][number]): boolean => row.actions.includes(action)
  const taken = setsStore.getState().sets.filter((s) => s.id !== row.id).map((s) => s.name)
  const taggable = useSets((s) => {
    const set = s.sets.find((one) => one.id === row.id)
    return set !== undefined && canTag(set)
  })
  const renameError = renaming === null ? null : setNameError(renaming, taken)

  const select = (): void => {
    const set = setsStore.getState().sets.find((s) => s.id === row.id)
    if (set) actions.setSelection(selectableMembers(set))
  }
  const isolate = (): void => {
    const set = setsStore.getState().sets.find((s) => s.id === row.id)
    if (set) actions.soloLayers(layout, partsOfSet(set))
  }
  const rename = (): void => {
    if (renaming === null || renameError !== null) return
    if (renaming.trim() !== row.name) void setActions.edit(row.id, { name: renaming.trim() })
    setRenaming(null)
  }

  return (
    <li
      className="row layer-row layer-set"
      data-set={row.id}
      data-proposed={row.proposed ? '' : undefined}
      data-in-part={indent ? '' : undefined}
      onPointerEnter={() => light(true)}
      onPointerLeave={() => light(false)}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) light(true)
      }}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) light(false)
      }}
    >
      <span className="swatch set-swatch" data-proposed={row.proposed ? '' : undefined} style={{ ['--set-colour' as string]: setColourVar(row.colour) }} aria-hidden="true" />
      {renaming === null ? (
        <button type="button" className="row-name layer-name set-name num" title={`${row.ref}: select its members`} onClick={() => select()}>
          {row.ref}
        </button>
      ) : (
        <input
          className="set-rename"
          type="text"
          autoFocus
          value={renaming}
          maxLength={SET_NAME_MAX}
          aria-label={`New name of ${row.ref}`}
          aria-invalid={renameError !== null}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setRenaming(e.target.value)}
          onKeyDown={(e) => {
            if (pressed(e, 'field.keep')) {
              e.preventDefault()
              rename()
              giveKeysBack(e.currentTarget)
            } else if (pressed(e, 'field.leave')) {
              e.preventDefault()
              e.stopPropagation()
              setRenaming(null)
            }
          }}
        />
      )}
      {row.comment !== '' && (
        <span className="set-comment" title={row.comment}>
          {row.comment}
        </span>
      )}
      <span className="layer-count set-said" title={`${row.count} ${row.count === 1 ? 'member' : 'members'}`}>
        {numbered(row.said)}
      </span>
      <button
        type="button"
        className="icon-button layer-solo"
        aria-label={`Show only ${row.ref}`}
        title="Show only the parts of this set"
        disabled={!has('isolate')}
        onClick={(e) => {
          isolate()
          if (e.detail > 0) giveKeysBack(e.currentTarget)
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="5.25" />
          <circle cx="8" cy="8" r="1.75" />
        </svg>
      </button>
      {!row.proposed && (
        <button type="button" className="icon-button set-more" aria-expanded={shown} aria-label={`More for ${row.ref}`} title="Rename, colour, add or take away what is selected, delete" onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.1" />
            <circle cx="8" cy="8" r="1.1" />
            <circle cx="12.5" cy="8" r="1.1" />
          </svg>
        </button>
      )}
      {renameError !== null && (
        <p className="set-line set-error" role="alert">
          {renameError}
        </p>
      )}
      {row.proposed && <p className="set-line set-proposed">Proposed by Claude</p>}
      {row.lost !== null && (
        <p className="set-line set-lost" data-part="lost">
          {row.lost}
        </p>
      )}
      {shown && (
        <div className="set-line set-actions" role="group" aria-label={`${row.ref}`}>
          {has('accept') && (
            <button type="button" className="button button-primary set-button" title="Make this set yours: it stays, and Claude can use it by name" onClick={() => void setActions.accept(row.id)}>
              Accept
            </button>
          )}
          {has('dismiss') && (
            <button type="button" className="button set-button" title="Turn this proposal down: the set is deleted" onClick={() => void setActions.dismiss(row.id)}>
              Dismiss
            </button>
          )}
          {has('rename') && (
            <button type="button" className="link-button set-button" onClick={() => setRenaming(row.name)}>
              Rename
            </button>
          )}
          {has('recolour') && (
            <button type="button" className="link-button set-button" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
              Colour
            </button>
          )}
          {has('add') && (
            <button type="button" className="link-button set-button" disabled={!selected} title="Add what is selected to this set" onClick={() => void setActions.addSelection(row.id)}>
              Add selection
            </button>
          )}
          {has('take') && (
            <button type="button" className="link-button set-button" disabled={!selected} title="Take what is selected out of this set" onClick={() => void setActions.takeSelection(row.id)}>
              Take away selection
            </button>
          )}
          {has('repick') && !repicking && (
            <button type="button" className="link-button set-button" title="Pick the lost members again: select the faces, then press Re-pick" onClick={() => setActions.startRepick(row.id)}>
              Re-pick
            </button>
          )}
          {has('tag') && (
            <button
              type="button"
              className="link-button set-button"
              disabled={!taggable}
              title={taggable ? 'Ask Claude to write this set into the model as a tag, one in each part it spans' : 'A tag names faces and edges: this set has none that the build found'}
              onClick={() => void makeTag(row.id)}
            >
              Make it a tag
            </button>
          )}
          {has('delete') && (
            <button type="button" className="link-button set-button" title="Delete this set. Undo puts it back" onClick={() => void setActions.remove(row.id)}>
              Delete
            </button>
          )}
        </div>
      )}
      {repicking && (
        <div className="set-line set-actions" role="group" aria-label={`Re-pick ${row.ref}`}>
          <span className="set-hint">Select what takes the place of the lost ones, then</span>
          <RepickButton id={row.id} />
          <button type="button" className="link-button set-button" onClick={() => setActions.cancelRepick()}>
            Cancel
          </button>
        </div>
      )}
      {choosing && shown && (
        <div className="set-line set-colours" role="radiogroup" aria-label={`Colour of ${row.ref}`}>
          {Array.from({ length: SET_COLOURS }, (_v, n) => (
            <button
              key={n}
              type="button"
              role="radio"
              className="set-colour"
              aria-checked={row.colour === n}
              aria-label={`Colour ${n + 1}`}
              style={{ ['--set-colour' as string]: setColourVar(n) }}
              onClick={() => {
                void setActions.edit(row.id, { colour: n })
                setChoosing(false)
              }}
            />
          ))}
        </div>
      )}
    </li>
  )
}

/** The second press of Re-pick: it is for what is selected now, so it says how many. */
function RepickButton({ id }: { id: string }) {
  const count = useStore((s) => s.selection.length)
  return (
    <button type="button" className="button button-primary set-button" disabled={count === 0} onClick={() => void setActions.repick(id)}>
      {count === 0 ? 'Re-pick' : `Re-pick with ${count} selected`}
    </button>
  )
}

/** "Named sets": the sets that are of no one part, with the last that was deleted and what main refused. */
export function NamedSets({ rows, layout }: { rows: SetRow[]; layout: string }) {
  const removed = useSets((s) => s.removed)
  const refused = useSets((s) => s.refused)
  const problem = useSets((s) => s.problem)
  if (rows.length === 0 && removed === null && refused === null && problem === null) return null
  return (
    <div className="layer-sets" data-part="named-sets">
      {rows.length > 0 && <h3 className="layer-sets-head">Named sets</h3>}
      {rows.length > 0 && (
        <ul className="rows">
          {rows.map((row) => (
            <SetRowView key={row.id} row={row} layout={layout} />
          ))}
        </ul>
      )}
      <SetsNotes />
    </div>
  )
}

/** What happened to a set that the person should read: what was deleted, with Undo, why main refused a change, and what main found wrong with the sets file. Shown once, wherever the sets are. */
export function SetsNotes() {
  const removed = useSets((s) => s.removed)
  const refused = useSets((s) => s.refused)
  const problem = useSets((s) => s.problem)
  return (
    <>
      {problem !== null && (
        <p className="set-note selectable" role="status" data-part="sets-problem">
          {problem}{' '}
          <button type="button" className="link-button" onClick={() => setActions.dismissProblem()}>
            Dismiss
          </button>
        </p>
      )}
      {removed !== null && (
        <p className="set-note" role="status">
          Deleted <span className="num">{removed.name}</span> ·{' '}
          <button type="button" className="link-button" onClick={() => void setActions.undo()}>
            Undo
          </button>
        </p>
      )}
      {refused !== null && (
        <p className="set-note set-error" role="alert">
          {refused}
        </p>
      )}
    </>
  )
}
