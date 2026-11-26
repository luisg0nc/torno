import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { type RenameResult, namesTaken, partNameRefusal } from '../shared/rename'
import type { Scene } from '../shared/scene'
import type { ObjectInfo } from '../shared/workspace'
import { writeFileAtomic } from './atomic'
import type { Builds } from './builds'
import { absolute, ownFile, unfit } from './goback'
import { ensureIgnored } from './ignored'
import { ownTorno, writeOwn } from './own'

// Renaming a part by hand (#359): the person renames "shell" to "front case" in the Parts tab or the picker, and torno
// writes the new name into the model itself. The kernel finds where the name is written (`part_sites`, by the AST of the
// project's own files, read only) and answers with each place and its bytes; main checks them against the file as it is,
// writes each file whole (`writeFileAtomic`), which the watcher builds as any save, has torno's own files that name the part follow it (marks,
// named sets, tracings, scans: each by its own store), and keeps a notice that the next prompt carries to Claude, so that
// it keeps the new name. Besides Go back it is the one place torno writes the model.

export type { RenameResult }

/** One place the kernel found the name written: the file from the workspace with `/`, the bytes and what to put there. */
export interface PartSite {
  file: string
  line: number
  start: number
  end: number
  old: string
  new: string
}

/** The kernel's answer to `part_sites`. */
export type PartSites = { sites: PartSite[]; files: Record<string, string> } | { refused: string }

export interface RenameDeps {
  /** The scene of the last good build. */
  scene: () => Scene | undefined
  /** The kernel's `part_sites` of that build. */
  sites: (part: string, to: string) => Promise<PartSites>
  builds: Pick<Builds, 'state'>
  /**
   * Whether the project's sources are now the ones the last good build was made from (`sourcesHash` against the build's
   * record): a save the watcher has not built yet, or a build that failed since, may hold names the build does not know.
   */
  sourcesBuilt: () => Promise<boolean>
  /** Why the project's session will not have it now (`Sessions.busyWith`), or null. */
  busy?: () => string | null
  /** torno's own files that name the part follow it: each store in its turn. A failure of one is said, not undone. */
  follow: (from: string, to: string) => Promise<void>
}

const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Renames the part `from` to `to` in the model, or says why not. Refused while the session works, waits on the person or
 * has prompts untaken, while a build runs, before a build worked, for a name `partNameRefusal` refuses, and for whatever
 * the kernel refuses (a name not written plainly, written where it may not be this part). Every place is checked before
 * the first write: an own `.py` of the project, a plain file, the bytes the kernel read (its hash) and the old text at
 * each span. Each file is then read again and written whole; a file changed meanwhile or a write that fails puts back the
 * files written before it and says so. Refused too while the last build is not of the files as they are (it failed, is
 * stale, or a save has not been built): the names it knows are what "taken" is judged by.
 */
export async function renamePart(obj: ObjectInfo, ask: { from: unknown; to: unknown }, deps: RenameDeps): Promise<RenameResult> {
  const refuse = (refused: string): RenameResult => ({ done: false, refused })
  if (typeof ask.from !== 'string' || typeof ask.to !== 'string') return refuse('That is not a part of this project.')
  const from = ask.from
  const to = ask.to.trim()
  const busy = deps.busy?.()
  if (busy) return refuse(busy)
  const state = deps.builds.state(obj.id)
  if (state?.status === 'building') return refuse('A build is running. Wait for it to end, then rename.')
  const scene = deps.scene()
  if (!scene) return refuse('The model has not built yet: rename once it has.')
  // What is taken is judged by the last build: it must be of the files as they are, or a name added since would be written twice.
  if (state?.status !== 'ok' || state.stale) return refuse('The last build is not of the model as it is now (it failed, or a save is not built yet): rename once it builds.')
  if (!scene.parts.some((p) => p.name === from)) return refuse(`${from} is not a part of the last build.`)
  const why = partNameRefusal(from, to, namesTaken(scene))
  if (why) return refuse(why)
  if (!(await deps.sourcesBuilt())) return refuse('The model changed since its last build: rename once the build of it ends.')
  let answer: PartSites
  try {
    answer = await deps.sites(from, to)
  } catch (e) {
    return refuse(`The kernel could not say where ${from} is named: ${said(e)}`)
  }
  if ('refused' in answer) return refuse(answer.refused)
  if (!Array.isArray(answer.sites) || answer.sites.length === 0) return refuse(`${from} is not written in the model where torno can rename it.`)
  const own = basename(obj.dir)
  const byFile = new Map<string, PartSite[]>()
  for (const site of answer.sites) {
    if (!ownFile(own, site.file)) return refuse(`${site.file} is not a file of this project, so torno does not write it.`)
    byFile.set(site.file, [...(byFile.get(site.file) ?? []), site])
  }
  // Everything checked before the first write: what is written is what the kernel read, changed only at its spans.
  const written = new Map<string, Buffer>()
  for (const [file, sites] of byFile) {
    const unfitFor = await unfit(obj, file, true)
    if (unfitFor) return refuse(`${file} cannot be written: ${unfitFor}.`)
    const bytes = await readFile(absolute(obj, file)).catch(() => null)
    if (bytes === null) return refuse(`${file} cannot be read.`)
    if (sha256(bytes) !== answer.files?.[file]) return refuse(`${file} changed while torno looked: try again.`)
    let out = bytes
    let after = Number.POSITIVE_INFINITY
    for (const site of [...sites].sort((a, b) => b.start - a.start)) {
      const fits = Number.isInteger(site.start) && Number.isInteger(site.end) && site.start >= 0 && site.start < site.end && site.end <= after && typeof site.old === 'string' && typeof site.new === 'string'
      if (!fits || bytes.subarray(site.start, site.end).toString('utf8') !== site.old) return refuse(`Where ${from} is written in ${file} line ${site.line} is not what the kernel read: try again.`)
      out = Buffer.concat([out.subarray(0, site.start), Buffer.from(site.new, 'utf8'), out.subarray(site.end)])
      after = site.start
    }
    written.set(file, out)
  }
  // Each file is read again just before it is written, so that a save made since the check is never overwritten; when one
  // cannot be written, those written before it are put back as they were, so the model is never left half renamed.
  const done: string[] = []
  const was = new Map<string, Buffer>()
  const putBack = async (): Promise<string> => {
    const left: string[] = []
    for (const file of done.reverse()) await writeFileAtomic(absolute(obj, file), was.get(file)!).catch(() => left.push(file))
    return left.length > 0 ? ` ${left.join(', ')} could not be put back as ${left.length === 1 ? 'it was' : 'they were'}: look at ${left.length === 1 ? 'it' : 'them'}.` : ' Nothing was changed.'
  }
  for (const [file, bytes] of written) {
    const now = await readFile(absolute(obj, file)).catch(() => null)
    if (now === null || sha256(now) !== answer.files[file]) return refuse(`${file} changed while torno renamed: try again.${await putBack()}`)
    was.set(file, now)
    try {
      await writeFileAtomic(absolute(obj, file), bytes)
      done.push(file)
    } catch (e) {
      return refuse(`${file} could not be written: ${said(e)}.${await putBack()}`)
    }
  }
  // The build of the new name is the watcher's, as of any save of the person's (the project is the one on screen, which a save
  // builds): a rebuild asked here as well would be started again by the watcher's burst a moment later.
  await deps.follow(from, to).catch((e) => console.error(`after renaming ${from} to ${to} in ${obj.id}: ${said(e)}`))
  const inProject = done.map((file) => file.slice(own.length + 1))
  try {
    await keepRenameNotice(obj.dir, { from, to, files: inProject, at: new Date().toISOString() })
  } catch (e) {
    console.error(`cannot keep the notice of the rename in ${obj.id}: ${said(e)}`)
  }
  return { done: true, to, files: done }
}

/** One rename the next prompt tells: `.torno/renamed.json` holds them, oldest first. */
interface Renamed {
  from: string
  to: string
  /** The files written, from the project's folder. */
  files: string[]
  at: string
}
const NOTICE = 'renamed.json'
/** How many renames the notice keeps and names. */
const MOST_RENAMES = 6
/** How much of a name it says. */
const NAME_TEXT = 60
/** The most the sentence takes of a prompt: it is told on top of CONTEXT_LIMIT, as Go back's is. */
export const RENAME_LIMIT = 600

function renamesOf(raw: unknown): Renamed[] | null {
  const list = (raw as { renames?: unknown } | null)?.renames
  if (!Array.isArray(list)) return null
  const fine = (r: Partial<Renamed>): r is Renamed => typeof r?.from === 'string' && typeof r.to === 'string' && typeof r.at === 'string' && Array.isArray(r.files) && r.files.every((f) => typeof f === 'string')
  return list.every(fine) ? list.map((r) => ({ from: r.from, to: r.to, files: r.files.slice(0, 20), at: r.at })) : null
}

/**
 * Keeps a rename for the next prompt, after those not told yet. A rename of a name that was itself renamed since the agent
 * was told is folded into it (shell to case, then case to front case, says shell to front case), and one that puts a name
 * back is no rename at all.
 */
export async function keepRenameNotice(dir: string, now: Renamed): Promise<void> {
  const folder = await ownTorno(dir)
  const before = await readFile(join(folder, NOTICE), 'utf8').then((text) => renamesOf(JSON.parse(text) as unknown), () => null).catch(() => null)
  const renames = [...(before ?? [])]
  const earlier = renames.findIndex((r) => r.to === now.from)
  if (earlier >= 0) {
    const was = renames[earlier]
    renames.splice(earlier, 1)
    if (was.from !== now.to) renames.push({ from: was.from, to: now.to, files: [...new Set([...was.files, ...now.files])], at: now.at })
  } else renames.push(now)
  if (renames.length === 0) {
    await rm(join(folder, NOTICE), { force: true })
    return
  }
  await ensureIgnored(dir, [NOTICE])
  await writeOwn(dir, NOTICE, `${JSON.stringify({ renames: renames.slice(-MOST_RENAMES) })}\n`)
}

const named = (name: string): string => (name.length > NAME_TEXT ? `${name.slice(0, NAME_TEXT - 1)}…` : name)
const files = (r: Renamed): string => (r.files.length === 0 ? 'the model' : r.files.slice(0, 3).join(', '))

/** The sentence of the renames, at most RENAME_LIMIT characters: renames past the room are counted, never cut in half. */
function renameText(renames: readonly Renamed[]): string {
  if (renames.length === 1) return `The person renamed the part ${named(renames[0].from)} to ${named(renames[0].to)} in ${files(renames[0])}; keep the new name.`
  const head = 'The person renamed parts in the model: '
  const said: string[] = []
  for (const [i, r] of renames.entries()) {
    const line = `${named(r.from)} to ${named(r.to)} in ${files(r)}`
    const left = renames.length - i - 1
    const tail = left > 0 ? `; and ${left} more` : ''
    if (said.length > 0 && head.length + [...said, line].join('; ').length + tail.length + 20 > RENAME_LIMIT) {
      said.push(`and ${renames.length - i} more`)
      break
    }
    said.push(line)
  }
  return `${head}${said.join('; ')}. Keep the new names.`
}

/**
 * What the next prompt tells Claude of the renames, and how to let the notice go once the answer has left (as Go back's
 * notice, `takeGoBackNotice`): `done` removes the file only if it is still the one read. Null with none.
 */
export async function takeRenameNotice(dir: string): Promise<{ text: string; done: () => Promise<void> } | null> {
  const folder = await ownTorno(dir).catch(() => null)
  if (folder === null) return null
  const path = join(folder, NOTICE)
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  const renames = (() => {
    try {
      return renamesOf(JSON.parse(text) as unknown)
    } catch {
      return null
    }
  })()
  if (!renames || renames.length === 0) {
    await rm(path, { force: true }).catch(() => {})
    return null
  }
  const told = renameText(renames)
  return {
    text: told,
    done: async () => {
      if ((await readFile(path, 'utf8').catch(() => null)) === text) await rm(path, { force: true }).catch(() => {})
    }
  }
}
