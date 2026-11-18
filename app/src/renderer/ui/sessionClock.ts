/** Seconds as the header says how long Claude Code has worked: `0:42`, `12:05`, `1:02:05`. */
export function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const s = String(whole % 60).padStart(2, '0')
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
