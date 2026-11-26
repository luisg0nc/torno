import { useId } from 'react'
import type { ShelfPart } from '../../../shared/shelf'
import { partGroups, timesUsed, useShelf } from '../../state/shelf'
import { findShelf, shelfCounts, shelfFind, SHELF_FILTERS, useShelfFind } from '../../state/shelfFind'
import { boardActions } from '../../state/board'
import { placingActions, SHELF_DRAG_TYPE, usePlacing } from '../../state/placing'
import { useStore } from '../../state/store'
import { giveKeysBack } from '../typing'
import { PartLine, PartPicture } from '../shelf/PartBits'
import { pressed } from '../../../shared/keys'
import type { Scene } from '../../../shared/scene'

/**
 * The Shelf tab of the bench: the parts of `common/parts/`, each as a row: its side outline at the one scale of the shelf (the
 * kernel's section, never a drawing of ours), its name, what it cuts, a row of short rules that say how sure its sizes are (a
 * solid one has a source, a thick green one is checked on the part, a dashed one is assumed, a dotted one is worked out), and how
 * many of it the open project used. A row is dragged onto the model to place the part there (`state/placing.ts`, #353). The parts the project used come first, under its name, and then the rest. A find box and
 * three chips narrow them. A row is a button, so Enter on it is a click too: it opens the part (`boardActions.openPart`: `store.shelfOpen`, and the part's
 * page in the view, #352). The foot says where the parts come from; dropping a datasheet is #355.
 */
export function ShelfPanel() {
  const parts = useShelf((s) => s.parts)
  const scene = useStore((s) => s.scene)
  const project = useStore((s) => (s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId) || 'this project')
  const chosen = useStore((s) => s.shelfOpen)
  const query = useShelfFind((s) => s.query)
  const filter = useShelfFind((s) => s.filter)
  const counts = shelfCounts(parts, scene)
  const shown = findShelf(parts, scene, query, filter)
  const { here, other } = partGroups(shown, scene)
  return (
    <div className="shelf-tab">
      <div className="shelf-head">
        <div className="params-find shelf-find">
          <svg className="shelf-find-icon" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.3 9.3 12.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            className="params-find-input"
            data-shelf-find=""
            placeholder="Find a part or a size"
            aria-label="Find a part or a size"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => shelfFind.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (pressed(e, 'field.leave')) {
                if (query !== '') shelfFind.setQuery('')
                giveKeysBack(e.currentTarget)
                e.stopPropagation()
              } else if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
            }}
          />
        </div>
        <div className="shelf-chips" role="group" aria-label="Show">
          {SHELF_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="shelf-chip"
              data-filter={id}
              aria-pressed={filter === id}
              onClick={(e) => {
                shelfFind.setFilter(id)
                if (e.detail > 0) giveKeysBack(e.currentTarget)
              }}
            >
              {label} <span className="num">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="shelf-scroll">
        {shown.length === 0 ? (
          <p className="shelf-none" role="status">
            No part matches
          </p>
        ) : (
          <>
            <Group title={`In ${project}`} parts={here} scene={scene} chosen={chosen} />
            <Group title="Not in this project" parts={other} scene={scene} chosen={chosen} />
          </>
        )}
      </div>
      <div className="shelf-foot">
        <span>
          All at one scale. From <span className="file">common/parts/</span>, which Claude keeps.
        </span>
        <span>Drag a part onto the model, or drop a datasheet, STEP or photo here.</span>
      </div>
    </div>
  )
}

function Group({ title, parts, scene, chosen }: { title: string; parts: ShelfPart[]; scene: Scene | null; chosen: string | null }) {
  const id = useId()
  if (parts.length === 0) return null
  return (
    <section className="shelf-group" aria-labelledby={id}>
      <h3 className="shelf-group-title" id={id}>
        {title} <span className="num">{parts.length}</span>
      </h3>
      {parts.map((part) => (
        <Row key={part.id} part={part} used={timesUsed(scene, part.id)} hot={chosen === part.id} />
      ))}
    </section>
  )
}

function Row({ part, used, hot }: { part: ShelfPart; used: number | null; hot: boolean }) {
  const lifted = usePlacing((s) => s.dragging === part.id)
  return (
    <button
      type="button"
      className={`shelf-row${hot ? ' hot' : ''}${lifted ? ' lifted' : ''}`}
      data-part={part.id}
      aria-current={hot ? 'true' : undefined}
      draggable
      onClick={() => boardActions.openPart(part.id)}
      onDragStart={(e) => {
        // Only the part's id, in a type of torno's own: dropped on the composer, a field or the desktop it is nothing.
        e.dataTransfer.setData(SHELF_DRAG_TYPE, part.id)
        e.dataTransfer.effectAllowed = 'copy'
        // After the browser has taken its picture of the row: a row changed in dragstart can end the drag at once.
        setTimeout(() => placingActions.drag(part.id), 0)
      }}
      onDragEnd={() => placingActions.drag(null)}
    >
      <PartPicture part={part} />
      <span className="shelf-text">
        <b className="shelf-name">{part.name}</b>
        <PartLine part={part} />
      </span>
      <span className="shelf-used num">{used === null ? '' : `× ${used}`}</span>
    </button>
  )
}
