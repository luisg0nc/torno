import type { Ready } from '../../shared/ready'

export type Tone = 'ok' | 'warn' | 'fail' | 'wait'

/** The sign at the head of a line: a tick, !, × (the ok, warn and fail colours say the rest), and an ellipsis while it waits. */
export const glyphOf = (tone: Tone): string => ({ ok: '✓', warn: '!', fail: '×', wait: '…' })[tone]

/** A piece of a line: plain words, or something set in the face of numbers and refs (a path, a version, a command). */
export type Piece = string | { num: string }

export interface Line {
  id: 'claude' | 'uv' | 'kernel' | 'project'
  label: string
  tone: Tone
  text: Piece[]
  /** A second line in the muted face. */
  note?: Piece[]
  /** What uv printed while it makes torno's environment, the newest last. */
  progress?: string[]
  /** Waiting for something that is quick and says nothing more (the kernel starting, its environment made): the block may fold over it. */
  quiet?: boolean
  /** The one thing the line can do: make torno's own Python environment. */
  action?: 'make'
}

const num = (value: string): Piece => ({ num: value })

/** The pieces as one string. */
export const flat = (pieces: Piece[]): string => pieces.map((p) => (typeof p === 'string' ? p : p.num)).join('')

/** A line as a sentence, its label first: for tests and for what a screen reader is told. */
export const text = (line: Line): string => `${line.label} ${flat(line.text)}`

const PREPARING = "Preparing torno's Python environment (the first time takes a minute or two)."

function claudeLine(ready: Ready): Line {
  const { claude } = ready
  const base = { id: 'claude', label: 'Claude Code' } as const
  if (claude.path === null) {
    return {
      ...base,
      tone: 'fail',
      text: ['Not found on PATH. Install Claude Code and log in, then reopen torno. See Requirements in the README.'],
      note: ['Looked in ', num(ready.searched === '' ? '(empty)' : ready.searched)]
    }
  }
  const where: Piece[] = ['found at ', num(claude.path), ...(claude.version ? [', version ', num(claude.version)] : [])]
  if (claude.account === 'signed-out') {
    return { ...base, tone: 'fail', text: [...where, ', but not signed in. Run ', num('claude'), ' in a terminal and log in, then check again.'] }
  }
  if (claude.silent) {
    return { ...base, tone: 'warn', text: [...where, ', but it did not answer when asked. It may start and leave at once.'] }
  }
  const note =
    claude.range && claude.version && claude.tested
      ? [`Claude Code ${claude.version} is ${claude.range} than the versions torno was checked with (${claude.tested.min} to ${claude.tested.max}): if something in the chat looks wrong, this may be why.`]
      : undefined
  return { ...base, tone: 'ok', text: [...where, ...(claude.account === 'signed-in' ? [', signed in'] : [])], ...(note ? { note } : {}) }
}

function uvLine(ready: Ready): Line | null {
  if (ready.uv.path !== null) return null
  return { id: 'uv', label: 'uv', tone: 'fail', text: ['Not found on PATH. Install it from ', num('docs.astral.sh/uv'), ', then reopen torno.'] }
}

/** The environment of a folder with a `pyproject.toml`: torno only says whether it is there, and never makes it. */
function projectLine(ready: Ready): Line | null {
  if (ready.environment.kind !== 'workspace') return null
  const base = { id: 'project', label: 'This folder' } as const
  if (ready.environment.made) return { ...base, tone: 'ok', text: ['has a ', num('pyproject.toml'), ', and its ', num('.venv'), ' is there'] }
  return { ...base, tone: 'fail', text: ['has a ', num('pyproject.toml'), ' but no ', num('.venv'), '. Run ', num('uv sync'), ' in it once and open it again: torno never does that.'] }
}

function kernelLine(ready: Ready): Line | null {
  const { environment, kernel, making, uv } = ready
  const base = { id: 'kernel', label: 'Kernel' } as const
  const uvVersion: Piece[] = uv.version ? [', uv ', num(uv.version)] : []
  // A folder's own environment that is not there is said once, in its own line.
  if (environment.kind === 'workspace' && !environment.made) return null
  if (kernel.state === 'ready') {
    const { build123d, python } = kernel.versions
    return { ...base, tone: 'ok', text: [...(build123d ? ['build123d ', num(build123d)] : ['started']), ...(python ? [', Python ', num(python)] : []), ...uvVersion] }
  }
  const missing = environment.kind === 'torno' && !environment.made
  if (kernel.state === 'starting') return { ...base, tone: 'wait', text: [missing ? PREPARING : 'Starting.'], ...(missing ? {} : { quiet: true }) }
  // No workspace is open, or its kernel stopped and the next build starts it again: torno's own environment, as it stands.
  if (making.state === 'making') return { ...base, tone: 'wait', text: [PREPARING], progress: making.lines }
  // A kernel that failed for want of the environment can have it made now, before the build that tries again.
  if (kernel.state === 'failed') return { ...base, tone: 'fail', text: [`Did not start: ${kernel.reason}`], ...(missing && uv.path !== null ? { action: 'make' as const } : {}) }
  if (uv.path === null) return null
  if (making.state === 'failed' && missing) return { ...base, tone: 'fail', text: [`Could not make torno's Python environment: ${making.reason}`], progress: making.lines, action: 'make' }
  if (missing) return { ...base, tone: 'warn', text: ['Not made yet: about 900 MB is fetched the first time, so the first run needs the network.'], action: 'make' }
  return { ...base, tone: 'ok', text: ["torno's Python environment is made", ...uvVersion] }
}

/** What torno needs, a line for each, in the order they matter. */
export function readinessLines(ready: Ready): Line[] {
  return [claudeLine(ready), uvLine(ready), projectLine(ready), kernelLine(ready)].filter((l): l is Line => l !== null)
}

/** Whether every line is ready: only then does the block fold to one line. A kernel that is starting, its environment there, is a matter of seconds and does not keep it open. */
export const allReady = (lines: Line[]): boolean => lines.length > 0 && lines.every((l) => l.tone === 'ok' || (l.tone === 'wait' && l.quiet === true))

/** The lines that say something is missing or amiss. */
export const lacking = (lines: Line[]): Line[] => lines.filter((l) => l.tone === 'warn' || l.tone === 'fail')

/**
 * Whether a build that is running is the one that makes torno's Python environment (the first time, about 900 MB): the
 * kernel is starting and the environment it runs in is torno's and was not made. The status line says so in place of its seconds.
 */
export const makesEnvironment = (ready: Ready | null): boolean => ready !== null && ready.kernel.state === 'starting' && ready.environment.kind === 'torno' && !ready.environment.made

/** The one line the block folds to when everything is ready: "Claude Code 2.1.4 and build123d 0.13.0 are ready" (the version, when it was asked for). */
export function foldedLine(ready: Ready, lines: Line[]): string {
  const claude = ready.claude.version ? `Claude Code ${ready.claude.version}` : 'Claude Code'
  const kernel = ready.kernel.state === 'ready' && ready.kernel.versions.build123d ? `build123d ${ready.kernel.versions.build123d}` : null
  if (kernel === null) return lines.some((l) => l.id === 'kernel') ? `${claude} and torno's Python environment are ready` : `${claude} is ready`
  return `${claude} and ${kernel} are ready`
}
