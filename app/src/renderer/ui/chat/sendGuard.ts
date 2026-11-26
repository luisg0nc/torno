/**
 * One send at a time from a box: while a send runs (a copy of the files of a part for the shelf, a picture still being made, the call to main), a
 * second one (Enter twice, a click after Enter) is let go, not run beside it. The box and its buttons are held for as long (`busy`).
 */
export function sendGuard(): { busy(): boolean; run(job: () => Promise<void>): Promise<boolean> } {
  let running = false
  return {
    busy: () => running,
    /** Runs `job` unless one runs; false when it was let go. The guard is open again when the job ends, however it ends. */
    async run(job) {
      if (running) return false
      running = true
      try {
        await job()
      } finally {
        running = false
      }
      return true
    }
  }
}
