import { useEffect, useState } from 'react'
import { pressed } from '../../shared/keys'
import { profileSaid, useProfile } from '../state/profile'
import { useStore } from '../state/store'
import { Popover } from './Popover'
import { PrintProfile } from './PrintProfile'

/**
 * The print profile, in the status line: a chip that says the printer and the material the open project is made for
 * (`Bambu X1C, PETG`, or "Print profile" while it has none) and, pressed, opens the choosers in a popover above it.
 * A press anywhere else, or Escape, puts the popover away.
 */
export function ProfileChip() {
  const objectId = useStore((s) => s.objectId)
  const said = profileSaid(useProfile(objectId))
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!shown) return
    const away = (e: PointerEvent): void => {
      const target = e.target
      if (target instanceof Element && (target.closest('.profile-pop') || button?.contains(target))) return
      setShown(false)
    }
    const escape = (e: KeyboardEvent): void => {
      if (!pressed(e, 'sheet.close')) return
      e.stopPropagation()
      e.preventDefault()
      setShown(false)
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [shown, button])

  return (
    <>
      <button
        ref={setButton}
        type="button"
        className="status-profile"
        aria-haspopup="dialog"
        aria-expanded={shown}
        aria-label="Print profile"
        aria-description={said === 'none' ? undefined : said}
        title="The printer and the material this project is made for"
        onClick={() => setShown(!shown)}
      >
        {said === 'none' ? 'Print profile' : said}
      </button>
      {shown && (
        <Popover anchor={button} side="above" width={300} className="profile-pop" aria-label="Print profile" onClose={() => setShown(false)}>
          <PrintProfile />
        </Popover>
      )}
    </>
  )
}
