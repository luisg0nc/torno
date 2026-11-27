import type { BuildDiagnosis } from './diagnosis'
import type { KeptCause } from './history'

export type BuildStatus = 'idle' | 'building' | 'ok' | 'failed'
export interface BuildError {
  kind: string
  message: string
  traceback?: string
  output?: string
  /** Why a fillet, a chamfer or a boolean of build123d failed, found by the worker that failed (`diagnose.py`, `booleans.py`); `sameAs` of a fillet's edges is main's. */
  diagnosis?: BuildDiagnosis
  /** `output` is the stderr of the kernel process that stopped (set by main where it makes that error), not what the model printed. */
  kernelStderr?: true
}
/** What a build was started for: a change of the files, the person's `Params`, the Rebuild button, a Go back, or the project being opened. */
export type BuildReason = 'watch' | 'params' | 'rebuild' | 'goback' | 'open'
export interface BuildState {
  objectId: string
  status: BuildStatus
  revision: number            // last successful build; 0 if none
  startedAt?: number          // ms epoch, while building
  seconds?: number            // duration of the last finished build
  error?: BuildError          // when failed
  stale: boolean              // true when the parts on screen are older than the latest attempt
  /** Building, but the kernel is on another project's build: this one starts when that ends (`Builds`). */
  waiting?: true
  /** The kernel let the last build of this object go to make room for the one running (memory): nothing answers of it until a build lands. */
  letGo?: 'memory'
  /** What the build was started for (`Builds`); main's, so it is not taken from the window. */
  reason?: BuildReason
  /** For the reason `goback`: the id of the kept build it restores. */
  wentBackTo?: string
  /** Whose the saves were that the build is of: Claude's, by its tool calls, or the person's. Absent for a build of no save heard (an opening, a Rebuild). Main's. */
  made?: KeptCause
}

/** The key of "Rebuild", written out: main's sentences name it and do not carry the table of keys (`keys.test.ts` holds it to the table). */
export const REBUILD_KEY = 'Ctrl+Shift+B'
/** How whoever is told that something must be built again is told how: the button is in the status line, whatever the build's state. */
export const REBUILD_HOW = `Press Rebuild in the status line of torno (${REBUILD_KEY}) to build again`

/** What is said, in the status line and to the agent, while the kernel holds no build of an object because it let the last one go to make room; null otherwise. */
export function letGoText(state: Pick<BuildState, 'status' | 'letGo'>): string | null {
  if (state.letGo !== 'memory') return null
  if (state.status === 'building') return 'The last build was let go to make room (memory): tools answer when this one lands.'
  if (state.status === 'failed') return 'The last build was let go to make room (memory) and this one failed: tools answer once the model builds again.'
  // Let go for another object's build, with none of its own on the way: one is started when a tool or the person asks something of it.
  return 'This build was let go to make room (memory): it is built again when something is asked of it.'
}

/** The most of a failed build's error that a line of the chat keeps, in characters. */
export const ERROR_LINE = 300

/**
 * What the build line of the chat shows of a failure: the last line of its traceback, which names the kind
 * (`NameError: name 'WAL' is not defined`), or of its message where it has no traceback; cut to what a line holds.
 */
export function errorLine(error: Pick<BuildError, 'message' | 'traceback'>): string {
  const lastOf = (text: string | undefined): string => (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? ''
  const line = lastOf(error.traceback) || lastOf(error.message)
  return line.length > ERROR_LINE ? `${line.slice(0, ERROR_LINE - 1)}…` : line
}

/**
 * Which build a failure is told as: a revision names a build that worked, as the builds count them, so a failure
 * has no number of its own and is "the build after r2" (the one still on show), or "the first build" when none
 * has worked yet. `revision` is `BuildState.revision`.
 */
export function failedAfter(revision: number): string {
  return revision > 0 ? `build after r${revision}` : 'first build'
}

/** The kinds of failure that come of something other than the model, so that building the same sources again may work. */
const OUTSIDE_THE_MODEL: readonly string[] = ['crash', 'timeout', 'cancelled']

/** A failed build said in words, for the person: what happened, and the kernel's word for it only where torno has no better. */
export function kindWords(kind: string | undefined): string {
  switch (kind) {
    case undefined: return 'The build failed'
    case 'exception': return 'Python error in the model'
    case 'timeout': return 'The build took too long (timeout)'
    case 'crash': return 'The build process stopped (crash)'
    case 'cancelled': return 'The build was cancelled'
    case 'no_model': return 'The folder has no model file'
    default: return `The build failed (${kind})`
  }
}

/**
 * Whether building the sources again is what may help, so that "Rebuild" is the primary button: after a failure outside
 * the model (a crash, a timeout, a cancel), or when the kernel let the build go for memory and nothing failed since.
 * After an error in the model it gives the same error, and the model is what is to be changed.
 */
export function rebuildHelps(build: Pick<BuildState, 'status' | 'error' | 'letGo'>): boolean {
  if (build.status === 'failed') return build.error !== undefined && OUTSIDE_THE_MODEL.includes(build.error.kind)
  return build.letGo === 'memory'
}

/** What "Ask Claude Code to fix it" puts in the message box: the error itself is not in it, Claude Code has been told it. */
export function fixPrompt(objectName: string): string {
  return `Fix the build of ${objectName}: see the error.`
}

/**
 * Whether the latest build is the failure a line of the chat tells of (`ChatItem` `context` of a build): the same
 * revision on show and the same last line of the error. Only then does the line open the sheet of it.
 */
export function stillLatest(build: Pick<BuildState, 'status' | 'revision' | 'error'> | null, item: { revision?: number; error?: string }): boolean {
  if (build?.status !== 'failed' || build.error === undefined || item.error === undefined) return false
  return build.revision === (item.revision ?? 0) && errorLine(build.error) === item.error
}

/**
 * Why the tools of the window wait, or null while they work. The parts on screen are the last good build and a build
 * under way or a failed one does not change that: the marks, picks and measures are of that build and are checked
 * against the next. They wait only when the kernel let that build go to make room (`letGo`): nothing can then be
 * asked of it, so a pick could not be described.
 */
export function picksWait(build: Pick<BuildState, 'status' | 'letGo'> | null | undefined): string | null {
  return build?.letGo === 'memory' ? 'The kernel let this build go to make room (memory): picks wait for a build' : null
}

/** Seconds as a clock: `0:05`, `1:40`. */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * What the status line says while a build runs: the build it makes (the one after the revision on show), how long it has
 * run, and the build on show. `shownRevision` is 0 before a first build has landed: nothing is on show then, and the
 * running build has no number to give.
 */
export function buildingText(shownRevision: number, seconds: number): { running: string | null; clock: string; shown: string | null } {
  return shownRevision > 0 ? { running: `r${shownRevision + 1}`, clock: clockText(seconds), shown: `r${shownRevision}` } : { running: null, clock: clockText(seconds), shown: null }
}
