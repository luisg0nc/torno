import type { Param, ParamValue } from '../../shared/scene'

/**
 * The value a field is nudged to, to see what it drives: a small step from what the last build used, inside the
 * `min` and `max` the field gives. A number moves by a tenth (at least `step`, else 0.5 mm; a count by 1); a flag turns over and a
 * choice takes the next one. Null for a field that cannot be tried, or where no other value is possible.
 */
export function nudgeOf(param: Param): ParamValue | null {
  const now = param.value ?? param.default
  switch (param.editable) {
    case 'bool':
      return typeof now === 'boolean' ? !now : null
    case 'choice': {
      const choices = param.choices ?? []
      const at = choices.indexOf(now as string | number)
      return choices.length < 2 ? null : (choices[(at + 1) % choices.length] as ParamValue)
    }
    case 'int':
    case 'float': {
      if (typeof now !== 'number' || !Number.isFinite(now)) return null
      const whole = param.editable === 'int'
      const step = whole ? 1 : Math.max(Math.abs(now) * 0.1, param.metadata?.step ?? 0, 0.5)
      const { min, max } = param.metadata ?? {}
      let to = now + step
      // Past the top of its range the step goes the other way, and a range too narrow for a whole step takes its end.
      if (max !== undefined && to > max) to = now - step
      if (min !== undefined && to < min) to = max !== undefined && max > now ? max : min
      if (max !== undefined && to > max) to = max
      return to === now ? null : to
    }
    default:
      return null
  }
}
