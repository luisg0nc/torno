import { pressed } from '../../../shared/keys'
import { MAX_SIZE_VALUE, MAX_SIZE_WHAT, MAX_SIZE_NOTE, PERSON_SOURCES, SIZE_UNITS, parseSize, type SizeSource, type SizeUnit } from '../../../shared/size'
import { onboarding, sizeProblem, type SizeDraft } from '../../state/onboard'
import { chosen, giveKeysBack, pointerChoice } from '../typing'

/** A row is left alone, not nagged about, while it is blank. */
const blank = (s: SizeDraft): boolean => s.what.trim() === '' && s.value.trim() === ''

function SizeRow({ size, n, disabled }: { size: SizeDraft; n: number; disabled: boolean }) {
  const problem = sizeProblem(size)
  const read = size.value.trim() === '' ? null : parseSize(size.value)
  const keep = (e: { key: string; currentTarget: HTMLElement }): void => {
    if (pressed(e as never, 'field.keep')) giveKeysBack(e.currentTarget)
  }
  return (
    <li className="size-row" aria-label={`Size ${n + 1}`}>
      <input
        className="size-what"
        type="text"
        data-first=""
        value={size.what}
        maxLength={MAX_SIZE_WHAT}
        disabled={disabled}
        placeholder="What it measures"
        aria-label={`What size ${n + 1} measures`}
        spellCheck
        autoComplete="off"
        onChange={(e) => onboarding.setSize(size.uid, { what: e.target.value })}
        onKeyDown={keep}
      />
      <input
        className="size-value num"
        type="text"
        value={size.value}
        maxLength={MAX_SIZE_VALUE}
        disabled={disabled}
        placeholder="186 × 128"
        aria-label={`Value of size ${n + 1}`}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onboarding.setSize(size.uid, { value: e.target.value })}
        onKeyDown={keep}
      />
      <select
        className="new-select num"
        aria-label={`Unit of size ${n + 1}`}
        value={size.unit}
        disabled={disabled}
        {...pointerChoice}
        onChange={(e) => {
          onboarding.setSize(size.uid, { unit: e.target.value as SizeUnit })
          chosen(e.currentTarget)
        }}
      >
        {SIZE_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <select
        className="new-select"
        aria-label={`Where size ${n + 1} came from`}
        value={size.source}
        disabled={disabled}
        {...pointerChoice}
        onChange={(e) => {
          onboarding.setSize(size.uid, { source: e.target.value as SizeSource })
          chosen(e.currentTarget)
        }}
      >
        {PERSON_SOURCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        className="size-note"
        type="text"
        value={size.note}
        maxLength={MAX_SIZE_NOTE}
        disabled={disabled}
        placeholder="A few words more"
        aria-label={`Note for size ${n + 1}`}
        spellCheck
        autoComplete="off"
        onChange={(e) => onboarding.setSize(size.uid, { note: e.target.value.replace(/[\r\n]+/g, ' ') })}
        onKeyDown={keep}
      />
      <button type="button" className="button button-quiet" aria-label={`Remove size ${n + 1}`} disabled={disabled} onClick={() => onboarding.remove('sizes', size.uid)}>
        Remove
      </button>
      {problem !== null && !blank(size) && (
        <p className="size-help" data-tone="warn" role="status">
          {problem}
        </p>
      )}
      {problem === null && read === null && (
        <p className="size-help">Kept as typed: Claude is told it is not read as numbers.</p>
      )}
    </li>
  )
}

/** The sizes the person knows: a row each (what it measures, the value as typed, the unit, where it came from), and a button to add one. */
export function SizesSlot({ sizes, disabled }: { sizes: SizeDraft[]; disabled: boolean }) {
  return (
    <>
      <ul className="size-list" aria-label="Sizes I know">
        {sizes.map((s, n) => (
          <SizeRow key={s.uid} size={s} n={n} disabled={disabled} />
        ))}
      </ul>
      <p className="new-help">Give what you measured: a size Claude guesses is the most common reason a part does not fit. A value is one number, or a × b, or a × b × c, with Ø or R in front.</p>
    </>
  )
}
