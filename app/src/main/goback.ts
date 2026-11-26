import { lstat, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { type BuildTurn, type GoBackPlan, type GoBackResult, type HistoryEntry, HISTORY_ID, causeOf, drawable } from '../shared/history'
import type { ObjectInfo } from '../shared/workspace'
import { writeFileAtomic } from './atomic'
import type { Builds } from './builds'
import { type History, historySourcePath, readHistory, readHistoryScene } from './history'
import { ensureIgnored } from './ignored'
import { FOLDER, ownTorno, writeOwn } from './own'
import { type Overrides, overrideValues, replaceOverrides, sameValue } from './paramsfile'
import { isInsideFolder } from './sessions/inside'

// "Go back to before this prompt": the one place torno writes and deletes files of the person's model. It puts the
// `.py` files of the project's own folder back as the copies in `.torno/history/h<n>/source/` hold them, removes the
// `.py` files of its own folder that the undone prompts made, puts the Params the person tried back, and leaves a
// notice that the next prompt carries to the agent. It never writes `common/` or another project's folder (a file
// of those that differs now is only said), and it writes nothing the window names: the window says which build and
// main works out the rest, again, when it is told to go ahead. The plan and the result are `shared/history.ts`'s.

export type { GoBackPlan, GoBackResult }

/** The notice kept for the next prompt: `.torno/goback.json`. */
interface Notice {
  to: string
  undone: string[]
  prompts: BuildTurn[]
  at: string
}
const NOTICE = 'goback.json'
/** How many prompts the notice names, and how much of each one's text. */
const NOTICE_PROMPTS = 6
const NOTICE_TEXT = 60
const MOST_NOTICE_PROMPTS = 200

/** A `.py` file of this project's own folder, as a path from the workspace with `/`: no way out of it, no hidden part. */
export function ownFile(own: string, file: unknown): file is string {
  if (typeof file !== 'string' || !file.endsWith('.py') || file.includes('\\') || file.includes('\0') || posix.normalize(file) !== file) return false
  const parts = file.split('/')
  return parts[0] === own && parts.length >= 2 && parts.every((part) => part !== '' && !part.startsWith('.'))
}

export const absolute = (obj: ObjectInfo, file: string): string => join(dirname(obj.dir), ...file.split('/'))
const bytesOf = (path: string): Promise<Buffer | null> => readFile(path).catch(() => null)
const equal = (a: Buffer | null, b: Buffer | null): boolean => (a === null || b === null ? a === b : a.equals(b))

/**
 * The build "before this prompt" is the newest one that can be drawn before the prompt's first (`prompt` is the id
 * of its chat item, else `t-<conversation>-<n>`); with none kept before it, the build that was current when the
 * prompt was sent (`startedFrom`, as the session saw it), when that one is kept; else a sentence. `drawnGone` is the
 * number of the newest build that drew of those the history let go (`readHistoryDrawnGone`): a gap in the ids above it
 * is failed builds only. Without it every gap is taken as one that drew.
 */
export function entryBefore(entries: readonly HistoryEntry[], prompt: string, startedFrom?: { run: string; revision: number }, drawnGone = Number.POSITIVE_INFINITY): HistoryEntry | { refused: string } {
  const first = entries.findIndex((e) => e.turn?.prompt === prompt)
  if (first < 0) return { refused: 'No build was kept for that prompt, so there is nothing to go back from.' }
  const earlier = entries.slice(0, first)
  const sent = startedFrom ? earlier.find((e) => drawable(e) && e.run === startedFrom.run && e.revision === startedFrom.revision) : undefined
  const at = earlier.findLastIndex(drawable)
  if (at >= 0) {
    // Builds let go between that one and the prompt's first that is left (an old starred one outlived them) say it is not the one before the prompt.
    const number = (e: HistoryEntry): number => Number(e.id.slice(1))
    if (number(entries[first]) - number(earlier[at]) === first - at || drawnGone <= number(earlier[at])) return earlier[at]
    return sent ?? { refused: 'The builds just before that prompt were let go, so the model as it was then is not kept.' }
  }
  return sent ?? { refused: 'Nothing was kept of the model before that prompt, so there is no build to go back to.' }
}

/** The overrides the build was made with, as `.torno/params.json` holds them; null when the build does not say. */
async function triedThen(obj: ObjectInfo, target: HistoryEntry): Promise<Overrides | null> {
  const applied = (await readHistoryScene(obj.dir, target.id))?.overrides?.applied
  if (!applied) return null
  const wanted: Overrides = {}
  for (const [name, value] of Object.entries(applied)) {
    const fileDefault = target.params?.[name]
    // An override is held against the file's default; one that is equal to it is no override, and one with no default to hold it to cannot stand.
    if (fileDefault !== undefined && !sameValue(value, fileDefault)) wanted[name] = { value, default: fileDefault }
  }
  return wanted
}

function differs(now: Record<string, unknown>, wanted: Overrides): boolean {
  const names = Object.keys(wanted)
  return names.length !== Object.keys(now).length || names.some((name) => !(name in now) || !sameValue(now[name], wanted[name].value))
}

/** What a Go back to the build `to` would do, or why it cannot. Reads only. */
export async function planGoBack(obj: ObjectInfo, to: string): Promise<GoBackPlan | { refused: string }> {
  if (typeof to !== 'string' || !HISTORY_ID.test(to)) return { refused: 'That is not a build of this project.' }
  const entries = await readHistory(obj.dir)
  const at = entries.findIndex((e) => e.id === to)
  if (at < 0) return { refused: 'That build is no longer kept, so the files cannot be put back to it.' }
  const target = entries[at]
  if (target.failed) return { refused: 'That build failed, so there is nothing of it to go back to.' }
  const after = entries.slice(at + 1)
  const prompts: BuildTurn[] = []
  for (const e of after) if (e.turn && !prompts.some((p) => p.prompt === e.turn!.prompt)) prompts.push(e.turn)
  // The saves of the person's own among them: builds of their saves, their tried Params, or of no known cause (never a prompt's, never a Go back's).
  const yours = (e: HistoryEntry): boolean => !e.failed && ['person', 'params', 'unknown'].includes(causeOf(e))
  const plan: GoBackPlan = { to, write: [], remove: [], leftAlone: [], changedSince: [], params: false, undone: after.map((e) => e.id), undoneSaves: after.filter(yours).map((e) => e.id), prompts }
  const own = basename(obj.dir)
  // The copies the target holds, read now: one that cannot be read is no copy, and a half-restored model is worse than none.
  const copies = new Map<string, Buffer>()
  for (const file of target.files) {
    const path = historySourcePath(obj.dir, target, file)
    const bytes = path === null ? null : await bytesOf(path)
    if (bytes !== null) copies.set(file, bytes)
    else if (ownFile(own, file)) return { ...plan, fallback: 'undo' }
  }
  if (target.files.length === 0 || copies.size === 0) return { ...plan, fallback: 'undo' }
  for (const [file, copy] of [...copies].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (equal(await bytesOf(absolute(obj, file)), copy)) continue
    if (ownFile(own, file)) plan.write.push(file)
    else plan.leftAlone.push(file)
  }
  // A file the undone prompts made: in no build up to `to`, in one after it, and not in the copy; there now.
  const seenBefore = new Set(entries.slice(0, at + 1).flatMap((e) => e.files))
  const seenAfter = new Set(after.flatMap((e) => e.files))
  for (const file of [...seenAfter].sort()) {
    if (!ownFile(own, file) || seenBefore.has(file) || copies.has(file)) continue
    const here = await lstat(absolute(obj, file)).catch(() => null)
    if (here?.isFile()) plan.remove.push(file)
  }
  // What the person changed since: a file this would write or remove that a save of theirs, among the builds after `to`,
  // put in another state than the build before it had it (or first brought); and one that is not as the newest build's copy had it.
  const touched = [...plan.write, ...plan.remove]
  const changed = new Set<string>()
  const last = new Map<string, Buffer | null>(touched.map((file) => [file, copies.get(file) ?? null]))
  for (const e of after) {
    if (e.files.length === 0) continue
    for (const file of touched) {
      if (!e.files.includes(file)) continue
      const path = historySourcePath(obj.dir, e, file)
      const bytes = path === null ? null : await bytesOf(path)
      if (bytes === null) continue
      const was = last.get(file) ?? null
      if (yours(e) && (was === null || !equal(was, bytes))) changed.add(file)
      last.set(file, bytes)
    }
  }
  const newest = entries.findLast(drawable)
  if (newest && newest.files.length > 0) {
    for (const file of touched) {
      if (!newest.files.includes(file)) {
        if ((await bytesOf(absolute(obj, file))) !== null) changed.add(file)
        continue
      }
      const path = historySourcePath(obj.dir, newest, file)
      const kept = path === null ? null : await bytesOf(path)
      if (kept !== null && !equal(await bytesOf(absolute(obj, file)), kept)) changed.add(file)
    }
  }
  plan.changedSince = touched.filter((file) => changed.has(file)).sort()
  const wanted = await triedThen(obj, target)
  if (wanted) plan.params = differs(overrideValues(obj.dir), wanted)
  return plan
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((file, i) => file === b[i])

/** Why a file may not be written or removed, or null. A link, a folder or anything not a plain file is not. */
export async function unfit(obj: ObjectInfo, file: string, mustExist: boolean): Promise<string | null> {
  const path = absolute(obj, file)
  if (!isInsideFolder(obj.dir, path)) return 'it is not inside the project'
  const here = await lstat(path).catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : e))
  if (here instanceof Error) return here.message
  if (here === null) return mustExist ? 'it is not there any more' : null
  return here.isFile() ? null : 'it is a link or a folder, not a plain file'
}

const said = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Goes back: puts the files, removes the others, puts the Params back, starts the build (`goback`, with `to`), marks
 * the builds after `to` undone and keeps the notice for the next prompt. `plan` is what the person was shown: it is
 * worked out again now and must be the same, so that what is written is what was confirmed and nothing a window
 * named. Everything is checked before the first file is written; each file is then whole or not there (`writeFileAtomic`),
 * and a failure stops at it, saying what was done and what failed, with nothing undone or told. Nothing is
 * done while a session works (`busy`) or a build runs.
 */
export async function applyGoBack(obj: ObjectInfo, plan: GoBackPlan, deps: { history: History; builds: Pick<Builds, 'rebuild' | 'state' | 'expect'>; busy?: () => string | null }): Promise<GoBackResult> {
  const refuse = (refused: string): GoBackResult => ({ done: [], refused })
  if (plan.fallback) return refuse('There is no copy of that build to put back: ask Claude to undo it instead.')
  const busy = deps.busy?.()
  if (busy) return refuse(busy)
  if (deps.builds.state(obj.id)?.status === 'building') return refuse('A build is running. Wait for it to end, then go back.')
  const now = await planGoBack(obj, plan.to)
  if ('refused' in now) return refuse(now.refused)
  if (now.fallback) return refuse('There is no copy of that build to put back: ask Claude to undo it instead.')
  if (!sameList(plan.write, now.write) || !sameList(plan.remove, now.remove)) return refuse('The files are not as they were when you were asked. Look again before going back.')
  const target = (await readHistory(obj.dir)).find((e) => e.id === now.to)!
  const copies = new Map<string, Buffer>()
  for (const file of now.write) {
    const path = historySourcePath(obj.dir, target, file)
    const bytes = path === null ? null : await bytesOf(path)
    if (bytes === null) return refuse(`The copy of ${file} cannot be read.`)
    copies.set(file, bytes)
  }
  for (const [files, mustExist] of [[now.write, false], [now.remove, true]] as const) {
    for (const file of files) {
      const why = await unfit(obj, file, mustExist)
      if (why) return { done: [], failed: { file, why } }
    }
  }
  // Before the first file is written: the watcher may report it and start a build, which is the Go back's, not the person's (`Builds.expect`).
  deps.builds.expect(obj.id, 'goback', now.to)
  const done: string[] = []
  const stop = (failed: { file: string; why: string }): GoBackResult => {
    deps.builds.expect(obj.id)
    return { done, failed }
  }
  for (const file of now.write) {
    try {
      await writeFileAtomic(absolute(obj, file), copies.get(file)!)
      done.push(file)
    } catch (e) {
      return stop({ file, why: said(e) })
    }
  }
  for (const file of now.remove) {
    try {
      await rm(absolute(obj, file))
      done.push(file)
    } catch (e) {
      return stop({ file, why: said(e) })
    }
  }
  if (now.params) {
    const wanted = await triedThen(obj, target)
    try {
      if (wanted) await replaceOverrides(obj.dir, wanted)
      done.push(`${FOLDER}/params.json`)
    } catch (e) {
      return stop({ file: `${FOLDER}/params.json`, why: said(e) })
    }
  }
  // Right after the files, so that the build is the Go back's before the watcher reports them (`Builds.changed`).
  deps.builds.rebuild(obj.id, 'goback', now.to)
  deps.builds.expect(obj.id)
  await deps.history.markUndone(obj, now.undone)
  try {
    await keepNotice(obj.dir, { to: now.to, undone: now.undone, prompts: now.prompts, at: new Date().toISOString() })
  } catch (e) {
    return { done, failed: { file: `${FOLDER}/${NOTICE}`, why: said(e) } }
  }
  return { done }
}

const isTurn = (t: unknown): t is BuildTurn => typeof t === 'object' && t !== null && typeof (t as BuildTurn).prompt === 'string' && ((t as BuildTurn).text === undefined || typeof (t as BuildTurn).text === 'string') && ((t as BuildTurn).conversation === undefined || typeof (t as BuildTurn).conversation === 'string')

/** What a file holds when it is a notice of main's, else null. */
function noticeOf(raw: unknown): Notice | null {
  const n = raw as Partial<Notice> | null
  if (!n || typeof n !== 'object' || typeof n.to !== 'string' || !HISTORY_ID.test(n.to) || typeof n.at !== 'string') return null
  if (!Array.isArray(n.undone) || !n.undone.every((id) => typeof id === 'string' && HISTORY_ID.test(id)) || !Array.isArray(n.prompts) || !n.prompts.every(isTurn)) return null
  return { to: n.to, undone: n.undone, prompts: n.prompts.slice(0, MOST_NOTICE_PROMPTS).map((t) => ({ prompt: t.prompt, ...(t.conversation ? { conversation: t.conversation } : {}), ...(t.text ? { text: t.text } : {}) })), at: n.at }
}

/** The notice is kept until a prompt carries it; a second Go back before then adds to it, so the agent hears of both. */
async function keepNotice(dir: string, now: Notice): Promise<void> {
  const folder = await ownTorno(dir)
  const before = await readFile(join(folder, NOTICE), 'utf8').then((text) => noticeOf(JSON.parse(text) as unknown), () => null).catch(() => null)
  const prompts = [...(before?.prompts ?? [])]
  for (const t of now.prompts) if (!prompts.some((p) => p.prompt === t.prompt)) prompts.push(t)
  const merged: Notice = { to: now.to, undone: [...new Set([...(before?.undone ?? []), ...now.undone])], prompts: prompts.slice(-MOST_NOTICE_PROMPTS), at: now.at }
  await ensureIgnored(dir, [NOTICE])
  await writeOwn(dir, NOTICE, `${JSON.stringify(merged)}\n`)
}

/** A prompt as the notice names it: its words, short, in quotes. */
function label(t: BuildTurn): string {
  const text = (t.text ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim()
  if (text === '') return 'one with no words kept'
  return `"${text.length > NOTICE_TEXT ? `${text.slice(0, NOTICE_TEXT - 1).trimEnd()}…` : text}"`
}

/**
 * What the next prompt tells the agent, and how to let the notice go. The file stays until `done` is called, which the
 * caller does once the answer that holds the text has been handed over (a prompt whose answer never left tells it
 * again); `done` removes it only if it is still the one that was read, so a Go back made meanwhile is not lost. Null
 * when there is no notice (or the file is not main's: that one is removed at once).
 */
export async function takeGoBackNotice(dir: string): Promise<{ text: string; done: () => Promise<void> } | null> {
  const folder = await ownTorno(dir).catch(() => null)
  if (folder === null) return null
  const path = join(folder, NOTICE)
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  const notice = (() => {
    try {
      return noticeOf(JSON.parse(text) as unknown)
    } catch {
      return null
    }
  })()
  if (!notice) {
    await rm(path, { force: true }).catch(() => {})
    return null
  }
  const names = notice.prompts.map(label)
  const list = `${names.slice(0, NOTICE_PROMPTS).join(', ')}${names.length > NOTICE_PROMPTS ? ` and ${names.length - NOTICE_PROMPTS} more` : ''}`
  const undone = names.length > 0 ? `and prompts ${list} are undone` : 'and the builds after it are undone'
  return {
    text: `The person went back to build ${notice.to}: the model files are as they were then, ${undone}. You keep what you learnt from them; do not try them again unless asked.`,
    done: async () => {
      if ((await readFile(path, 'utf8').catch(() => null)) === text) await rm(path, { force: true }).catch(() => {})
    }
  }
}
