import { useEffect, useState } from 'react'

/** How long a number takes to get to its value (the spec's "Motion": the table's new numbers). */
export const COUNT_MS = 700

/** Whether the person asked for less motion; a window that cannot say (a static render) is asked for none. */
export function reducedMotion(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The number `elapsed` ms into the count from `from` to `to`: eased out, and `to` itself at the end, never a rounding short of it. */
export function countAt(from: number, to: number, elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / COUNT_MS))
  return t >= 1 ? to : from + (to - from) * (1 - (1 - t) ** 3)
}

/** The numbers (by their `once` key) that have counted in this window: a line drawn again, scrolled back or loaded from the log, does not count again. */
const counted = new Set<string>()

/** Whether a number counts at all: not under reduced motion, not when it did not move, not when it counted before. */
export function counts(from: number, to: number, once?: string): boolean {
  return !reducedMotion() && from !== to && !(once !== undefined && counted.has(once))
}

/**
 * A number that counts from `from` to `to` once, in 0.7 s, written by `format` (the format of the app, `shared/format.ts`).
 * It shows `to` at once under reduced motion, and in a render that cannot move. `once`: a key the count is made
 * only once for in this window.
 */
export function CountUp({ from, to, format, once }: { from: number; to: number; format: (n: number) => string; once?: string }) {
  const [shown, setShown] = useState(() => (counts(from, to, once) ? from : to))
  useEffect(() => {
    if (!counts(from, to, once)) {
      setShown(to)
      return
    }
    if (once !== undefined) counted.add(once)
    const began = performance.now()
    let frame = 0
    const step = (now: number): void => {
      setShown(countAt(from, to, now - began))
      if (now - began < COUNT_MS) frame = requestAnimationFrame(step)
    }
    setShown(from)
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [from, to, once])
  return <span className="num count-up">{format(shown)}</span>
}
