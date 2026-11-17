import { useEffect, useRef } from 'react'
import { fitNumber, number } from '../../../shared/format'
import { STRAIGHT_NEEDS } from '../../../shared/lineup'
import type { TracingPhoto } from '../../../shared/tracings'
import { EyeIcon } from '../Layers'

// The photo of a tracing as rows in its panel: its thumbnail, how it was lined up (the scale, the angle, how many points and whether one was
// spare to check them), always with "not exact" beside them, a fade slider, Hide, and what can be done with it. A photo that is not on this
// computer says so, and its line-up is still told. Pure, so that it is drawn the same from any state: what is done goes out by callbacks.

export interface PhotoRowsProps {
  photo: TracingPhoto
  /** The thumbnail's address (an object URL); null when there is none. */
  thumb: string | null
  /** Whether the photo's file is on this computer. */
  here: boolean
  /** The fade as the slider moves: not sent to main. */
  onFade?: (fade: number) => void
  /** The fade where the slider was let go: sent once. */
  onFadeCommit?: (fade: number) => void
  onHide?: (hidden: boolean) => void
  onLineUp?: () => void
  onSwap?: () => void
  onRemove?: () => void
}

const points = (n: number): string => `${n} ${n === 1 ? 'point' : 'points'}`

/** The scale, the angle and how the line-up was made, as the row says them. The scale and angle are blank for a photo not lined up. */
export function photoFigures(photo: TracingPhoto): { lined: boolean; scale: string; angle: string; how: string } {
  const lined = photo.transform !== undefined && photo.scale !== undefined
  if (!lined) return { lined, scale: '', angle: '', how: 'not lined up yet' }
  const fit = photo.fit === undefined ? 'no spare point to check it' : `fit ${fitNumber(photo.fit)} mm`
  return {
    lined,
    scale: `${number(photo.scale as number)} px/mm`,
    angle: photo.angle === undefined ? '' : `${number(photo.angle)}°`,
    how: `${points(photo.pairs.length)}, ${photo.method === 'straight' && photo.pairs.length >= STRAIGHT_NEEDS ? 'straightened, ' : ''}${fit}`
  }
}

/** The slider: moves are told as they happen (the drawing follows), and the value once when it is let go (the native `change`, which React's `onChange` is not). */
function FadeSlider({ fade, onInput, onCommit }: { fade: number; onInput?: (fade: number) => void; onCommit?: (fade: number) => void }) {
  const el = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => {
    const input = el.current
    if (!input) return
    const done = (): void => commit.current?.(Number(input.value))
    input.addEventListener('change', done)
    return () => input.removeEventListener('change', done)
  }, [])
  return <input ref={el} className="tr-fade" type="range" min="0" max="1" step="0.05" defaultValue={fade} aria-label="Fade of the photo" onInput={(e) => onInput?.(Number(e.currentTarget.value))} />
}

export function PhotoRows({ photo, thumb, here, onFade, onFadeCommit, onHide, onLineUp, onSwap, onRemove }: PhotoRowsProps) {
  const said = photoFigures(photo)
  const hidden = photo.hidden === true
  return (
    <div className="tr-photo-rows" data-hidden={hidden ? '' : undefined} data-here={here ? undefined : 'no'}>
      <div className="tr-photo-main">
        {thumb !== null && here ? <img className="tr-thumb" src={thumb} alt="The photo, small" width="64" height="48" /> : <span className="tr-thumb tr-thumb-none" aria-hidden="true" />}
        <div className="tr-photo-said">
          {!here && <p className="tr-photo-away">photo not on this computer</p>}
          {said.lined ? (
            <p className="tr-photo-line">
              <span className="num">{said.scale}</span>
              {said.angle !== '' && (
                <>
                  {' · '}
                  <span className="num">{said.angle}</span>
                </>
              )}
              {' · '}
              <span className="tr-not-exact">not exact</span>
            </p>
          ) : null}
          <p className="tr-photo-how">{said.how}</p>
        </div>
      </div>
      <label className="tr-fade-row">
        <span className="tr-fade-label">Fade</span>
        <FadeSlider fade={photo.fade} onInput={onFade} onCommit={onFadeCommit} />
        <span className="tr-fade-value num" aria-hidden="true">
          {Math.round(photo.fade * 100)}%
        </span>
      </label>
      <div className="tr-actions">
        <button type="button" className="bar-button" aria-pressed={hidden} onClick={() => onHide?.(!hidden)} title={hidden ? 'Show the photo again' : 'Hide the photo (its line-up stays)'}>
          <EyeIcon open={!hidden} /> {hidden ? 'Show' : 'Hide'}
        </button>
        <button type="button" className="bar-button" disabled={!here} title={here ? 'Click the same spots again' : 'The photo is not on this computer'} onClick={onLineUp}>
          {said.lined ? 'Line up again' : 'Line up'}
        </button>
      </div>
      <div className="tr-actions">
        <button type="button" className="bar-button" onClick={onSwap} title="Another photo: the points on the tracing stay, and only the photo's are clicked again">
          Swap photo
        </button>
        <span className="tr-spacer" />
        <button type="button" className="link-button" onClick={onRemove}>
          Remove photo
        </button>
      </div>
    </div>
  )
}

export interface AddPhotoProps {
  /** The photos of the project's `reference/`, by the name its cards have. */
  references: readonly string[]
  /** What went wrong with the last picture, in words. */
  problem?: string | null
  busy?: boolean
  onChoose?: () => void
  onReference?: (file: string) => void
}

/** What a tracing with no photo offers: choose a file, take one of the project's references, or drop a picture on the view. */
export function AddPhoto({ references, problem, busy, onChoose, onReference }: AddPhotoProps) {
  return (
    <div className="tr-photo-add">
      <p className="tr-note">A photo goes under the outline, lined up with it by clicking the same spots on both. You can drop a picture on the view too.</p>
      <div className="tr-actions">
        <button type="button" className="bar-button" disabled={busy} onClick={onChoose}>
          Add photo
        </button>
      </div>
      {references.length > 0 && (
        <ul className="tr-photo-refs" aria-label="Photos of the project's references">
          {references.map((file) => (
            <li key={file}>
              <button type="button" className="link-button" data-reference={file} disabled={busy} onClick={() => onReference?.(file)}>
                {file.replace(/^reference\//, '')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem !== undefined && problem !== null && (
        <p className="tr-refused" role="status">
          {problem}
        </p>
      )}
    </div>
  )
}
