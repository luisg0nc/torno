import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_TEXT_CHARS } from '../../shared/board'
import type { Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import type { Overrides } from '../paramsfile'
import type { LiveFacts } from './text'

/** The most of `brief.md` that is read: a character takes at most four bytes. */
const BRIEF_BYTES = MAX_TEXT_CHARS * 4

/** The first `MAX_TEXT_CHARS` characters of `<dir>/brief.md`, when it is a plain file; undefined when there is none or it cannot be read. */
export async function readBrief(dir: string): Promise<string | undefined> {
  try {
    const path = join(dir, 'brief.md')
    if (!(await lstat(path)).isFile()) return undefined
    const file = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(BRIEF_BYTES)
      const { bytesRead } = await file.read(buffer, 0, BRIEF_BYTES, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').slice(0, MAX_TEXT_CHARS)
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}

/** What main already has of a project that a card of its board shows: the marks, the last build's Params and checks, the person's tries and the brief. */
export async function liveFacts(deps: { dir: string | undefined; marks: readonly Mark[]; scene: Scene | undefined; overrides(dir: string): Overrides }): Promise<LiveFacts> {
  const brief = deps.dir === undefined ? undefined : await readBrief(deps.dir)
  return {
    marks: new Map(deps.marks.map((m) => [m.id, m])),
    ...(deps.scene?.params ? { params: deps.scene.params } : {}),
    ...(deps.dir !== undefined ? { tried: deps.overrides(deps.dir) } : {}),
    ...(deps.scene?.checks ? { checks: deps.scene.checks } : {}),
    ...(brief !== undefined ? { brief } : {})
  }
}
