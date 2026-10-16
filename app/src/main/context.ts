import type { BuildState } from '../shared/build'
import { standingOf, unmetDimensions } from '../shared/dimension'
import { explodeText, isExploded } from '../shared/explode'
import { type DimensionMark, type Mark, isUnchecked } from '../shared/marks'
import type { ScanInfo } from '../shared/scans'
import type { Scene } from '../shared/scene'
import { type ViewState, MAX_SELECTION_REPORTED, planeText } from '../shared/view'
import type { ObjectInfo } from '../shared/workspace'
import { describeMark } from './marks/describe'
import { alignmentSaid, shownText } from './scans/said'

/** The most the agent is given with a prompt, in characters. */
export const CONTEXT_LIMIT = 6000
/** The most of it that says how the build stands, when there are marks to tell of as well. */
const STATUS_LIMIT = 2000
/** The most of it that lists the numbers of the marks still open. */
const OPEN_LIMIT = 300

const TRACEBACK_LINES = 12
const MESSAGE_LIMIT = 400
/** The most of it that says what is selected, and of that the most that is said of one ref. */
const SELECTION_LIMIT = 1000
const SELECTED_DESCRIPTOR_LIMIT = 100
/** The most of it that says what scans the object has, in one line. */
export const SCANS_LIMIT = 600
const MARKS_HEAD = 'Marks from the user (drawn in look pictures with these numbers):'
const STILL_OPEN_HEAD = 'Marks still open (this conversation has not seen them):'
/** A tool of torno's as Claude Code names it to its model: what is said when nothing says how another client does. */
const CLAUDE_TOOL = (tool: string): string => `mcp__torno__${tool}`
type ToolName = (tool: string) => string
const marksData = (toolName: ToolName): string => `; call ${toolName('marks')} for their data`

/**
 * The head of the dimensions: which build their values and verdicts are of,
 * and, while that is not the model as it now is (a build is running, or the
 * latest failed), that it is not. Read without it, a FAIL of the build before
 * is taken for a verdict on the edit just made.
 */
function dimensionsHead(deps: ContextDeps, objectId: string, revision: number | undefined): string {
  if (revision === undefined) return 'Dimensions (nothing is built yet):'
  const status = deps.build(objectId)?.status
  const why = status === 'building' ? '; a build is running, so these are not of your last edit' : status === 'failed' ? `; the latest build failed, so these are still of r${revision}` : ''
  return `Dimensions (measured on r${revision}${why}):`
}

/**
 * `4 pinned dimensions pass`; and of those among them whose end the build
 * moved, which are measured between what their ends name now, how many and
 * which: `(1 measured from what is under its ends now: M9)`. Only counted,
 * they would pass unseen for what they were placed on.
 */
function passing(passes: readonly DimensionMark[]): string {
  const moved = passes.filter((m) => m.anchorState === 'drifted')
  const said = moved.length === 0 ? '' : ` (${moved.length} measured from what is under ${moved.length === 1 ? 'its' : 'their'} ends now: ${moved.map((m) => m.id).join(', ')})`
  return `${passes.length} pinned dimension${passes.length === 1 ? ' passes' : 's pass'}${said}`
}

/** What is said in place of the marks that did not fit, and of the dimensions that did not. */
const moreMarksBy = (toolName: ToolName) => (count: number): string => `… and ${count} more: call ${toolName('marks')}`
const moreDimensionsBy = (toolName: ToolName) => (count: number): string => `… and ${count} more unmet or unmeasured: call ${toolName('marks')}`

export interface ContextDeps {
  object(objectId: string): ObjectInfo | undefined
  build(objectId: string): BuildState | undefined
  /** The last successful build. */
  scene(objectId: string): { revision: number; scene: Scene } | undefined
  /** What the window shows of the object, when it is the one open there. */
  view(objectId: string): ViewState | undefined
  /** The object the window shows. */
  openObjectId(): string | null
  /** The files of the object's `reference/` (`photo-1.jpg`), photos then doodles: told to a new conversation. None when it has none or cannot be read. */
  references?(objectId: string): string[]
  now?(): number
}

/** The most references a new conversation is told the names of; the rest are counted. */
const MOST_REFERENCES_NAMED = 12

/** The line that tells a new conversation which references the object has, or '' when it has none. */
export function referencesLine(files: readonly string[]): string {
  if (files.length === 0) return ''
  const named = files.slice(0, MOST_REFERENCES_NAMED).join(', ')
  const more = files.length > MOST_REFERENCES_NAMED ? ` and ${files.length - MOST_REFERENCES_NAMED} more` : ''
  return `The person's references for this object are in reference/: ${named}${more}. Read them when they matter; they are not attached.`
}

/** What goes with a prompt, and the marks it tells of for the first time: sent, once the agent has it. */
export interface PromptContext {
  text: string
  sentMarkIds: string[]
  /** What the text says of the build, as data for the chat's chips: the revision it names, and how that build stands. Absent where the text names none. */
  revision?: number
  buildState?: 'ok' | 'failed' | 'building'
  /** The refs the text says are selected (as many as it lists). Absent when it says none. */
  selection?: string[]
}

/**
 * What the agent is told with every prompt in an object: whether the last build
 * worked, what is on screen and what is selected there, each mark that is
 * news to it (the drafts, oldest first, a line each) and the numbers of the
 * marks still open, each with what the last build did to it; then the
 * dimensions it has been given that the build does not meet. At most
 * CONTEXT_LIMIT characters: marks that do not fit are counted, not listed,
 * and are not among `sentMarkIds`. Nothing for an object that is not in the
 * workspace.
 *
 * A draft is a mark of the person's the agent has not been given, or one it
 * was given that has changed since (`changed`), or one that the person
 * reopened, their own or the agent's (`reopened by the user`). In a
 * conversation that has not seen the marks (`fresh`:
 * the agent started another, as on /clear), the person's marks it was given
 * before are listed once more, since "M3" means nothing there.
 *
 * A dimension the agent has been given and that is not resolved is pinned:
 * a check of the part, measured on every build. Under `Dimensions (measured
 * on rN):` (`dimensionsHead`) each one that fails, cannot be measured or was not measured on the last build has
 * its line, with every prompt until it is otherwise, and after them the
 * number that pass is said. Those lines are not news and are not among
 * `sentMarkIds`; a dimension listed there is not named again among the open
 * marks. Room for the head, the count of those left out and the count of
 * those that pass is kept before any draft is listed.
 *
 * The scans of the object (`opts.scans`), when it has any, are said in one
 * line after the selection: each with how it is aligned in the layout on
 * screen (the first, of an object that is not open) and how it is shown.
 *
 * A new conversation (`newConversation`: the first prompt of a session not resumed, or `fresh`) is also told, in a last line, the files of the object's `reference/` (`referencesLine`),
 * to read when they matter: they are not attached.
 *
 * A tool of torno's is named as the agent's client names it to its model
 * (`opts.toolName`; as Claude Code does when nothing says).
 *
 * It changes nothing: whoever delivers the text turns `sentMarkIds` into sent.
 */
export function contextFor(deps: ContextDeps, objectId: string, marks: readonly Mark[] = [], opts: { fresh?: boolean; newConversation?: boolean; scans?: readonly ScanInfo[]; toolName?: (tool: string) => string } = {}): PromptContext {
  return withBuild(deps, objectId, contextText(deps, objectId, marks, opts))
}

/**
 * What the agent is told of the build after it edited the model (the answer to a `PostToolUse`): the first lines of
 * `contextFor` (how the build stands, the error and the end of its traceback when it failed) and its dimensions, in
 * the same words; nothing of the selection, the scans or the other marks. No mark is told by it: `sentMarkIds` is
 * always empty, and drafts are left for the next prompt.
 */
export function buildContextFor(deps: ContextDeps, objectId: string, marks: readonly Mark[] = [], opts: { toolName?: (tool: string) => string } = {}): PromptContext {
  const dimensions = marks.filter((m) => m.kind === 'dimension' && m.status !== 'draft' && m.status !== 'resolved')
  const told = contextText(deps, objectId, dimensions, { ...opts, buildOnly: true })
  return { ...withBuild(deps, objectId, told), sentMarkIds: [] }
}

function withBuild(deps: ContextDeps, objectId: string, told: PromptContext): PromptContext {
  if (told.text === '') return told
  const build = deps.build(objectId)
  const refs = selectedRefs(deps, objectId)?.refs.slice(0, MAX_SELECTION_REPORTED).map(({ ref }) => ref) ?? []
  return {
    ...told,
    ...(build && build.revision > 0 && build.status !== 'idle' ? { revision: build.revision } : {}),
    ...(build && build.status !== 'idle' ? { buildState: build.status === 'ok' ? 'ok' : build.status === 'failed' ? 'failed' : 'building' } : {}),
    ...(refs.length > 0 ? { selection: refs } : {})
  }
}

function contextText(deps: ContextDeps, objectId: string, marks: readonly Mark[], opts: { fresh?: boolean; newConversation?: boolean; scans?: readonly ScanInfo[]; toolName?: (tool: string) => string; buildOnly?: boolean }): PromptContext {
  const toolName = opts.toolName ?? CLAUDE_TOOL
  const moreMarks = moreMarksBy(toolName)
  const moreDimensions = moreDimensionsBy(toolName)
  const revision = deps.scene(objectId)?.revision
  const drafts = marks.filter((m) => m.status === 'draft')
  const open = marks.filter((m) => m.status !== 'resolved' && !drafts.includes(m))
  const pinned = open.filter((m): m is DimensionMark => m.kind === 'dimension')
  // Those that are not what the person asked for, or of which that cannot be said on this build.
  const { failing, unmeasured } = unmetDimensions(pinned, revision)
  const unmet = pinned.filter((m) => failing.includes(m) || unmeasured.includes(m))
  const passes = pinned.filter((m) => standingOf(m, revision) === 'pass')
  const passLine = passes.length > 0 ? passing(passes) : ''
  const DIMENSIONS_HEAD = dimensionsHead(deps, objectId, revision)
  // Under `Dimensions:` they are listed with every prompt: not once more among the marks this conversation has not seen.
  const still = opts.fresh ? open.filter((m) => m.author === 'user' && !unmet.includes(m as DimensionMark)) : []
  const told = drafts.length > 0 || open.length > 0
  const limit = told ? STATUS_LIMIT : CONTEXT_LIMIT
  // Every part of it is fitted to the limit by what it can spare; the cut holds for what none of them
  // foresaw, such as a very long name.
  const lines = [cutEnd(status(deps, objectId, limit), limit)]
  if (lines[0] === '') return { text: '', sentMarkIds: [] }
  const selected = opts.buildOnly ? '' : selection(deps, objectId)
  if (selected) lines.push(selected)
  // Before the marks are given their room: the line is counted in what they have left.
  const scanned = scansLine(deps, objectId, opts.scans ?? [])
  if (scanned) lines.push(scanned)
  const openLine = open.length > 0 && !opts.buildOnly ? `Open marks: ${openMarks(open, revision, toolName)}` : ''
  const named = layoutNamed(deps, objectId)
  // What the dimensions need at the least, kept from the drafts: the head, how many are left out, how many pass.
  const floor = (unmet.length > 0 ? 1 + DIMENSIONS_HEAD.length + 1 + moreDimensions(unmet.length).length : passLine ? 1 + DIMENSIONS_HEAD.length : 0) + (passLine ? 1 + passLine.length : 0)
  let used = lines.join('\n').length + (openLine ? openLine.length + 1 : 0) + floor
  /**
   * A head, and under it a line for each mark that fits; then how many did not. Returns the marks listed.
   * Nothing at all when there is no room for the head and that count: the marks are still among the open ones.
   */
  /** The last build's scene: what is nothing within a part is told as 0 (`describeMark`). */
  const built = deps.scene(objectId)?.scene
  const list = (head: string, listed: readonly Mark[], tagOf: (mark: Mark) => string | undefined, more = moreMarks): Mark[] => {
    if (listed.length === 0) return []
    if (used + 1 + head.length + 1 + more(listed.length).length > CONTEXT_LIMIT) return []
    // The head is said even when no mark fits under it: the line that counts them needs it.
    lines.push(head)
    used += 1 + head.length
    const fitting: Mark[] = []
    for (const [i, mark] of listed.entries()) {
      const tag = tagOf(mark)
      // A mark's coordinates and refs are in the frame of its layout, which may not be the one named above.
      // A region is of its scan in every layout: it is told in the one named above. Where none is (the object
      // is not the one open), in the first of its build, else its own, and its line says which: a place with no
      // layout named is no place. One whose scan is gone is told nowhere.
      const told = named ?? (mark.kind === 'region' ? (deps.scene(objectId)?.scene.layouts[0] ?? mark.layout) : undefined)
      const where = mark.kind === 'region' ? (named || mark.anchorState === 'orphaned' ? '' : ` [in layout ${told}]`) : mark.layout === named ? '' : ` [in layout ${mark.layout}]`
      const line = `${describeMark(mark, { revision, ...(built ? { scene: built } : {}), ...(opts.scans ? { scans: opts.scans } : {}), ...(told ? { layout: told } : {}), ...(tag ? { tag } : {}) })}${where}`
      const after = listed.length - i - 1
      // Room is kept for the line that says how many are left out, should the next one not fit.
      if (used + 1 + line.length + (after > 0 ? 1 + more(after).length : 0) > CONTEXT_LIMIT) {
        lines.push(more(listed.length - i))
        used += 1 + more(listed.length - i).length
        break
      }
      lines.push(line)
      used += 1 + line.length
      fitting.push(mark)
    }
    return fitting
  }
  // One of its own is a draft only because the person reopened it, and so is one of theirs that says so:
  // it was resolved, and that did not do. Another of theirs that it has been given before is told again
  // because it changed: it knows the number, unless this conversation is another.
  // One of its own that is a draft and was not reopened is a dimension the person holds to another value (`sentBefore`).
  const news = (mark: Mark): string | undefined =>
    mark.reopened || (mark.author === 'agent' && !mark.sentBefore) ? 'reopened by the user' : mark.sentBefore && (mark.author === 'agent' || !opts.fresh) ? 'changed' : undefined
  const listedDrafts = list(MARKS_HEAD, drafts, news)
  list(STILL_OPEN_HEAD, still, () => undefined)
  // The room kept for the dimensions is theirs now. The count of those that pass is still to come after them.
  used -= floor - (passLine ? 1 + passLine.length : 0)
  const listedUnmet = unmet.length > 0 ? list(DIMENSIONS_HEAD, unmet, () => undefined, moreDimensions) : []
  if (passLine) lines.push(...(unmet.length > 0 ? [] : [DIMENSIONS_HEAD]), passLine)
  // What has its line above is not named again; never longer than the line room was kept for.
  const rest = open.filter((m) => !listedUnmet.includes(m))
  if (rest.length > 0 && !opts.buildOnly) lines.push(`Open marks: ${openMarks(rest, revision, toolName, openLine.length - 'Open marks: '.length)}`)
  // A new conversation is told which references there are, last, and only when the line fits: it is no mark.
  const referred = (opts.fresh || opts.newConversation) && !opts.buildOnly ? referencesLine(deps.references?.(objectId) ?? []) : ''
  const joined = lines.join('\n')
  const text = referred && joined.length + 1 + referred.length <= CONTEXT_LIMIT ? `${joined}\n${referred}` : joined
  if (text.length <= CONTEXT_LIMIT) return { text, sentMarkIds: listedDrafts.map((m) => m.id) }
  // Every part above keeps to the room it has; this holds for what none of them foresaw. What is cut is
  // the end, and no mark whose line may be among it is said to have been told.
  return { text: cutEnd(text, CONTEXT_LIMIT), sentMarkIds: [] }
}

/**
 * The numbers of the marks still open, each with what the agent cannot rely
 * on of it: its part is gone, the build moved its surface, or nothing has
 * checked it against the build. When any is said, so is where their data is.
 */
function openMarks(open: readonly Mark[], revision: number | undefined, toolName: ToolName, limit = OPEN_LIMIT): string {
  const flag = (m: Mark): string => (m.anchorState === 'orphaned' ? ' (part gone)' : m.anchorState === 'drifted' ? ' (moved)' : isUnchecked(m, revision) ? ' (unchecked)' : '')
  const names = open.map((m) => `${m.id}${flag(m)}`)
  const after = names.some((name) => name.includes(' ')) ? marksData(toolName) : ''
  const full = names.join(', ') + after
  return full.length <= limit ? full : someOf(names, limit - after.length) + after
}

/**
 * What the person has selected in the window, as one line, or '' when it
 * cannot be said: the object is not the one open, the selection is of another
 * build than the last or of another layout than is shown, or the parts on
 * screen are stale. Its refs name geometry of one build only.
 */
function selectedRefs(deps: ContextDeps, objectId: string): { refs: NonNullable<NonNullable<ViewState['selection']>['refs']>; view: ViewState } | null {
  if (deps.openObjectId() !== objectId) return null
  const build = deps.build(objectId)
  const last = deps.scene(objectId)
  const view = deps.view(objectId)
  const refs = view?.selection?.refs
  if (!build || build.status !== 'ok' || build.stale || !last || !view || !Array.isArray(refs) || refs.length === 0) return null
  if (view.selection?.revision !== last.revision || view.layout !== layoutShown(view, last.scene)) return null
  return { refs, view }
}

function selection(deps: ContextDeps, objectId: string): string {
  const found = selectedRefs(deps, objectId)
  if (!found) return ''
  const { refs, view } = found
  const names = refs.slice(0, MAX_SELECTION_REPORTED).map(({ ref, descriptor }) => (descriptor ? `${ref} (${cutEnd(descriptor, SELECTED_DESCRIPTOR_LIMIT)})` : ref))
  // The window gives the first refs only, and how many are selected in all.
  const total = Math.max(refs.length, view.selection?.total ?? 0)
  const more = total > names.length ? ` and ${total - names.length} more` : ''
  // What is cut is what is said of the refs, never how many more there are.
  return `${cutEnd(`Selected: ${names.join(', ')}`, SELECTION_LIMIT - more.length)}${more}`
}

/**
 * The scans of an object in one line of at most `SCANS_LIMIT` characters, or '' when it has none: each by its
 * number and name, how it is aligned in the layout on screen (in the first, of an object that is not open, and in
 * none before anything is built) with what puts that in doubt (`alignmentSaid`), and, of the object on screen,
 * how the window last said it shows it. Those that do not fit are counted; but one whose alignment is rough, in
 * doubt or not checked is always named, with that in a word (`S2 (in doubt)`): a doubt is never counted away.
 */
function scansLine(deps: ContextDeps, objectId: string, scans: readonly ScanInfo[]): string {
  if (scans.length === 0) return ''
  const last = deps.scene(objectId)
  const open = deps.openObjectId() === objectId
  const view = open ? deps.view(objectId) : undefined
  const layout = last ? layoutShown(view, last.scene) : ''
  const told = scans.map((scan) => {
    const shown = view?.scans?.find((one) => one.id === scan.id)
    const aligned = layout ? alignmentSaid(scan, layout, last?.revision) : null
    return {
      whole: [`${scan.id} ${scan.name}`, ...(aligned ? [aligned.line] : []), ...(shown ? [shownText(shown)] : [])].join(', '),
      // What is left of it when there is no room: its number, and its doubt in a word. A doubt is never among "and 1 more".
      short: aligned && aligned.state !== 'aligned' && aligned.state !== 'not aligned' ? `${scan.id} (${aligned.state})` : null
    }
  })
  const head = 'Scans: '
  const more = (count: number): string => (count > 0 ? ` and ${count} more` : '')
  const pieces: string[] = []
  let dropped = 0
  const length = (extra: string): number => head.length + [...pieces, extra].join('; ').length + more(dropped + 1).length + 1
  told.forEach((one, i) => {
    // Room is kept for the doubts of those to come, each in a word.
    const later = told.slice(i + 1).reduce((sum, next) => sum + (next.short ? next.short.length + 2 : 0), 0)
    if (length(one.whole) + later <= SCANS_LIMIT) pieces.push(one.whole)
    else if (i === 0) pieces.push(cutEnd(one.whole, Math.max(40, SCANS_LIMIT - head.length - later - more(told.length).length - 1)))
    else if (one.short) pieces.push(one.short)
    else dropped += 1
  })
  return `${head}${pieces.join('; ')}${more(dropped)}.`
}

/** The layout on screen of an object that is open in the window: the one asked for by the view, when the build has it. */
function layoutShown(view: ViewState | undefined, scene: Scene): string {
  return view && scene.layouts.includes(view.layout) ? view.layout : (scene.layouts[0] ?? '')
}

/**
 * The layout the agent takes a mark to be in when nothing says otherwise: the
 * one the first line names (`status` does for a build that worked, of the
 * object open in the window), or the only one such an object has.
 */
function layoutNamed(deps: ContextDeps, objectId: string): string | undefined {
  const scene = deps.scene(objectId)?.scene
  if (!scene || deps.openObjectId() !== objectId) return undefined
  if (deps.build(objectId)?.status === 'ok') return layoutShown(deps.view(objectId), scene)
  return scene.layouts.length === 1 ? scene.layouts[0] : undefined
}

/**
 * How the layout on screen is drawn otherwise than built, for display: its parts apart, or cut by the person's
 * section. Said with whatever is said to be showing, whether the build is good, running or failed, so that
 * nothing seen of it is taken for where the parts are, or for all of them. '' when it is drawn as built, and
 * of a layout the view is not of.
 */
function drawnHow(view: ViewState | undefined, layout: string | undefined): string {
  if (!view || layout === undefined || view.layout !== layout) return ''
  if (isExploded(view.explode)) return `, ${explodeText(view.explode)} (display only)`
  return view.section ? `, cut by the ${planeText(view.section)} (display only)` : ''
}

/** How long a build took, as the first line says it: `(0.8 s)`; `(under 0.1 s)` for one too quick to time, never `(0.0 s)`. */
function took(seconds: number | undefined): string {
  if (seconds === undefined) return ''
  return seconds < 0.05 ? ' (under 0.1 s)' : ` (${seconds.toFixed(1)} s)`
}

/** How the build stands and what is on screen, in at most `limit` characters. */
function status(deps: ContextDeps, objectId: string, limit: number): string {
  const obj = deps.object(objectId)
  if (!obj) return ''
  // The window shows one object; of another, nothing is on screen: no layout, and no parts "showing".
  const open = deps.openObjectId() === objectId
  const head = open ? `[torno] ${obj.name}` : `[torno] ${obj.name} · not open in the torno window`
  const onScreen = open ? 'showing' : 'last built'
  const build = deps.build(objectId)
  if (!build || build.status === 'idle') return `${head} · not built yet.`
  // What is on screen meanwhile is drawn as the person left it: apart, or cut.
  const shownScene = deps.scene(objectId)?.scene
  const seen = open ? deps.view(objectId) : undefined
  const how = shownScene && seen && shownScene.layouts.includes(seen.layout) ? drawnHow(seen, seen.layout) : ''

  if (build.status === 'building') {
    const running =
      build.startedAt === undefined ? '' : ` (${Math.max(0, Math.floor(((deps.now?.() ?? Date.now()) - build.startedAt) / 1000))} s so far)`
    const shown = build.revision > 0 ? `${onScreen} r${build.revision}${how}` : 'nothing built yet'
    return `${head} · building${running} · ${shown}.`
  }

  if (build.status === 'failed') {
    const shown = build.revision > 0 ? `${onScreen} r${build.revision}${open ? ' (stale)' : ''}${how}` : 'nothing built yet'
    const first = `${head} · BUILD FAILED · ${shown}.`
    const message = cutEnd(build.error?.message ?? 'no reason was given', MESSAGE_LIMIT)
    const traceback = lastLines(build.error?.traceback ?? '', TRACEBACK_LINES)
    const room = limit - first.length - message.length - 2
    if (!traceback || room < 2) return `${first}\n${message}`
    // What is cut is the start of the traceback: its end says what went wrong.
    return `${first}\n${message}\n${cutStart(traceback, room)}`
  }

  const start = `${head} · build ok · r${build.revision}${took(build.seconds)}`
  const scene = deps.scene(objectId)?.scene
  if (!scene) return `${start}.`
  if (!open) {
    const lead = `${start} · parts: `
    const names = [...new Set(scene.parts.map((p) => p.name))]
    return `${lead}${fitted(names, '', limit - lead.length - 1)}.`
  }
  const view = deps.view(objectId)
  const layout = layoutShown(view, scene)
  const parts = scene.parts.filter((p) => p.layout === layout)
  const hidden = view ? parts.filter((p) => !view.visible.includes(p.key)).map((p) => p.name) : []
  // Drawn apart or cut for display: said with the layout, so that nothing seen of it is taken for where the parts are.
  const apart = drawnHow(view, layout)
  const lead = `${start} · layout ${layout}${apart} · parts: `
  const names = parts.map((p) => p.name)
  const room = limit - lead.length - 1
  return `${lead}${fitted(names, hidden.length > 0 ? ` (hidden: ${hidden.join(', ')})` : '', room)}.`
}

/** The names and what follows them, or as many of the names as fit in `room` characters. */
function fitted(names: string[], after: string, room: number): string {
  const full = names.join(', ') + after
  return full.length <= room ? full : someOf(names, room)
}

/** As many of the names as fit in `room` characters, and how many were left out. */
function someOf(names: string[], room: number): string {
  let text = ''
  for (let i = 0; i < names.length; i += 1) {
    const next = i === 0 ? names[i] : `${text}, ${names[i]}`
    const rest = ` and ${names.length - i - 1} more`
    if (next.length + rest.length > room) return `${text} and ${names.length - i} more`
    text = next
  }
  return text
}

function lastLines(text: string, count: number): string {
  return text.trimEnd().split('\n').slice(-count).join('\n')
}

function cutEnd(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function cutStart(text: string, limit: number): string {
  return text.length <= limit ? text : `…${text.slice(text.length - limit + 1)}`
}
