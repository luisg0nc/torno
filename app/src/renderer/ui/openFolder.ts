/** A folder as its row names it: its own name, and the path to it. */
export function nameOf(root: string): string {
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root
}

/** What a failed open says: what could not be opened, and why, without the wrapping IPC puts round the reason. */
export function openProblem(what: string, e: unknown): string {
  const reason = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e)
  return `${what} could not be opened: ${reason}`
}
