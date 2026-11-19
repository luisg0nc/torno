import { type ToolDeps, type ToolExtra, type ToolResult, failure, tidy } from './tools'

export interface WaitBuildArgs {
  seconds?: number
}

export const WAIT_DEFAULT_S = 60
export const WAIT_MAX_S = 600
const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * `wait_build`: waits for the build that runs, or the one a save has just started, to the agent's limit, and returns
 * its result. A build that outlasts the limit is said to (`limitReached`) and left running: the agent calls again.
 * What an edit's answer tells of a build (`ToolDeps.buildTold`) comes with the result.
 */
export async function waitBuildTool(deps: ToolDeps, objectId: string, args: WaitBuildArgs, extra: ToolExtra = {}): Promise<ToolResult> {
  if (!deps.object(objectId)) return failure(`unknown project: ${objectId}`)
  const seconds = args.seconds ?? WAIT_DEFAULT_S
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 1 || seconds > WAIT_MAX_S) return failure(`seconds is how long to wait at most: 1 to ${WAIT_MAX_S}`)
  if (!deps.build(objectId)) return failure('no build yet: the project has not been opened in the torno window')
  const began = Date.now()
  await extra.progress?.(0, 'waiting for the build')
  await deps.fresh?.settle(objectId, seconds * 1000, undefined, extra.signal)
  const waited = round1((Date.now() - began) / 1000)
  const build = deps.build(objectId)!
  const running = build.status === 'building'
  const newer = !running && deps.fresh?.newer(objectId) === true
  const limitReached = running || newer
  const last = deps.scene(objectId)?.revision ?? null
  const reading = running
    ? `Still building after ${waited} s${build.startedAt ? ` (it began ${round1((Date.now() - build.startedAt) / 1000)} s ago)` : ''}: r${build.revision + 1} is not done. Call wait_build again.`
    : newer
      ? `The model's files are newer than ${last === null ? 'the last build' : `r${last}`} and no build has begun after ${waited} s. Save the file again or ask the person to press Rebuild.`
      : build.status === 'failed'
        ? `The build failed after r${build.revision}: ${build.error?.message ?? 'no reason was given'}.`
        : build.seconds !== undefined
          ? `r${build.revision} is built (${round1(build.seconds)} s) and is current.`
          : `r${build.revision} is current.`
  const told = limitReached ? '' : await (deps.buildTold?.(objectId) ?? Promise.resolve('')).catch(() => '')
  const result = { status: build.status, revision: last, waited, limitReached, ...(build.seconds === undefined ? {} : { seconds: round1(build.seconds) }), stale: build.stale || limitReached, reading }
  return { content: [{ type: 'text' as const, text: JSON.stringify(tidy(result)) }, ...(told ? [{ type: 'text' as const, text: told }] : [])] }
}
