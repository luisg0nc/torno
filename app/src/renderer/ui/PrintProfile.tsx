import { useCallback, useEffect, useState } from 'react'
import { type Profile, type Profiles, FITS, profileName } from '../../shared/profile'
import { number } from '../../shared/format'
import { useStore } from '../state/store'
import { numbered } from './numbered'
import { SectionTitle } from './SectionTitle'
import { chosen, pointerChoice } from './typing'

const NONE = ''

/** What the printer and material say, for under the choosers: the person's numbers, in the monospace face. */
export function profileSummary(profile: Profile | null): string[] {
  const lines: string[] = []
  if (profile?.printer) lines.push(`Bed ${profile.printer.bed.map(number).join(' × ')} mm, nozzle ${number(profile.printer.nozzle)} mm`)
  if (profile?.material) {
    const m = profile.material
    lines.push(`${number(m.density)} g/cm³, gap per side ${FITS.map((f) => `${f} ${number(m.fits[f][0])} to ${number(m.fits[f][1])}`).join(', ')} mm`)
  }
  return lines
}

/**
 * The printer and the material the open project is made for. A choice is copied into `<project>/.torno/profile.json`
 * and sets the defaults of the agent's `check` and `measure mass`, and what it is told. The printers are the
 * person's, kept in torno's settings (not in the workspace): a new one is added here. The numbers are theirs, never
 * measured, and no verdict against them says the part prints. A section of the Params panel; its title says what is chosen.
 */
export function PrintProfile() {
  const objectId = useStore((s) => s.objectId)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [choices, setChoices] = useState<Profiles>({ printers: [], materials: [] })
  const [adding, setAdding] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (objectId === null) return
    let current = true
    setProblem(null)
    void Promise.all([window.torno.profile.get(objectId), window.torno.profile.choices()])
      .then(([kept, offered]) => {
        if (!current) return
        setProfile(kept)
        setChoices(offered)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [objectId])

  const keep = useCallback(
    (next: Profile): void => {
      if (objectId === null) return
      setProblem(null)
      window.torno.profile
        .set(objectId, next)
        .then((kept) => setProfile(kept))
        .catch((e: unknown) => setProblem(plain(e)))
    },
    [objectId]
  )

  if (objectId === null) return null
  const said = profile ? profileName(profile) : 'none'
  return (
    <section className="section print" aria-label="Print profile">
      <SectionTitle title="Print profile" said={said} />
      <div className="print-body">
        <label className="print-row">
          <span>Printer</span>
          <select
            aria-label="Printer"
            value={profile?.printer?.name ?? NONE}
            onPointerDown={pointerChoice.onPointerDown}
            onKeyDown={pointerChoice.onKeyDown}
            onChange={(e) => {
              const printer = choices.printers.find((p) => p.name === e.target.value)
              keep({ ...(printer ? { printer } : {}), ...(profile?.material ? { material: profile.material } : {}) })
              chosen(e.currentTarget)
            }}
          >
            <option value={NONE}>None</option>
            {choices.printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="print-row">
          <span>Material</span>
          <select
            aria-label="Material"
            value={profile?.material?.name ?? NONE}
            onPointerDown={pointerChoice.onPointerDown}
            onKeyDown={pointerChoice.onKeyDown}
            onChange={(e) => {
              const material = choices.materials.find((m) => m.name === e.target.value)
              keep({ ...(profile?.printer ? { printer: profile.printer } : {}), ...(material ? { material } : {}) })
              chosen(e.currentTarget)
            }}
          >
            <option value={NONE}>None</option>
            {choices.materials.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {profileSummary(profile).map((line) => (
          <p key={line} className="print-said">
            {numbered(line)}
          </p>
        ))}
        <p className="print-said">Your numbers, not measured: checks against them never say a part prints.</p>
        {adding ? (
          <AddPrinter
            onAdded={(offered, name) => {
              setChoices(offered)
              setAdding(false)
              const printer = offered.printers.find((p) => p.name === name)
              if (printer) keep({ printer, ...(profile?.material ? { material: profile.material } : {}) })
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="link-button print-add" onClick={() => setAdding(true)}>
            Add a printer…
          </button>
        )}
        {problem !== null && (
          <p className="print-problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    </section>
  )
}

const plain = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

function AddPrinter({ onAdded, onCancel }: { onAdded: (choices: Profiles, name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [bed, setBed] = useState(['256', '256', '256'])
  const [nozzle, setNozzle] = useState('0.4')
  const [problem, setProblem] = useState<string | null>(null)
  const submit = (): void => {
    const sizes = bed.map(Number)
    window.torno.profile
      .savePrinter({ name: name.trim(), bed: [sizes[0], sizes[1], sizes[2]], nozzle: Number(nozzle) })
      .then((offered) => onAdded(offered, name.trim()))
      .catch((e: unknown) => setProblem(plain(e)))
  }
  return (
    <form
      className="print-add-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="print-row">
        <span>Name</span>
        <input aria-label="Printer name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="print-row">
        <span>Bed, mm</span>
        <span className="print-bed num">
          {['X', 'Y', 'Z'].map((axis, i) => (
            <input key={axis} aria-label={`Bed ${axis}`} inputMode="decimal" value={bed[i]} onChange={(e) => setBed(bed.map((v, j) => (j === i ? e.target.value : v)))} />
          ))}
        </span>
      </div>
      <label className="print-row">
        <span>Nozzle, mm</span>
        <input aria-label="Nozzle" className="num" inputMode="decimal" value={nozzle} onChange={(e) => setNozzle(e.target.value)} />
      </label>
      <div className="print-buttons">
        <button type="submit" disabled={name.trim() === ''}>
          Add
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {problem !== null && (
        <p className="print-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  )
}
