import { type DimensionStanding, standingOf } from '../../shared/dimension'
import type { DimensionMark, Mark } from '../../shared/marks'
import { letGoText } from '../../shared/build'
import { diagnosisText } from '../../shared/diagnosis'
import { type ExplodeState, EXPLODED_NOTE, NOT_EXPLODED_AND_CUT, explodeArg, explodeText, isExploded, nothingApart, nothingApartText } from '../../shared/explode'
import type { ScanInfo } from '../../shared/scans'
import type { NamedSet } from '../../shared/sets'
import { noteText } from '../../shared/modelChecks'
import type { Scene } from '../../shared/scene'
import { type Camera, type LookRequest, type LookResult, type SaveViewRequest, type SaveViewResult, type SectionPlane, type ShowRequest, type ShowResult, type ViewName, axisForm, planeText } from '../../shared/view'
import { type SavedView, MAX_PROPOSALS, VIEW_NOT_BOTH, cleanViewName, findView, viewGone, viewNameRefusal, viewSummary } from '../../shared/views'
import { number } from '../../shared/format'
import { FOCUS_NOT_EXPLODED } from '../../shared/focus'
import { groupOf, groupsIn, groupVisibility, partsNamed } from '../../shared/groups'
import { tagRefs } from '../../shared/tags'
import { alignmentSaid } from '../scans/said'
import { setsListed } from '../sets/text'
import { type Focused, MARGIN_NEEDS_FOCUS, NO_SAVED_FRAME, focusOf, hiddenText, marginShare, notDrawn } from './focus'
import { unknownKeys } from './keys'
import { NO_LOOK_SCANS, NO_SCAN_OPACITY, NO_SHOW_SCANS, isScanOpacity, scanColourFor, scanIds } from './scanTools'
import { type CameraArg, type LookArgs, type SaveViewArgs, type ShowArgs, CAMERA_KEYS, FOV, VIEW_NAMES, explodeHelp } from './schemas'
import { modelOutput } from '../context'
import { type ToolDeps, type ToolResult, REFERENCE_NOTE, SPREAD_NOTE, TRACEBACK_LINES, built, clampSize, failure, lastLines, layoutFor, messageOf, notOpen, onScreen, planeArg, tidy } from './tools'

// The tools of the view: `scene`, which says what the object is and what the user sees of it, `look`, a picture
// from the window, `show`, which changes what the window shows for now, and `save_view`, which leaves the user a
// view the agent proposes. `look` and `show` take the name of a saved view (`namedView`).

/** Said in `scene` when a part's size or volume is not exact. */
export const REVERSED_NOTE = 'A part with reversed lists solids turned inside out (their faces point inward; the index counts its solids from 0): its volume is a size only and it is broken, so say so and mend the model.'
/** Said in `scene` when a part is not closed. */
export const OPEN_NOTE = 'A part with openShells has shells with an edge only one face has: it is not closed, so its volume says nothing of it; mend the model.'
/** Said in `scene` when what a part's mesh encloses is not its volume. */
export const MESH_NOTE = 'A part with meshDisagrees encloses with its mesh (meshVolume, approximate) other than its volume says, by more than the mesh explains: one of them is wrong; check the model before relying on either.'
export const APPROXIMATE_NOTE = 'A size (and bbox) with sizeExact false, or a volume with volumeExact false, is approximate: call measure for a number to rely on.'

/** What is said of a view that is neither a name nor a camera. */
export const NO_CAMERA = 'view, as a camera, takes position and target as [x, y, z] in mm, as scene gives them: {"position": [120, -90, 60], "target": [0, 0, 6]}; or give a name: current, iso, front, back, left, right, top, bottom, or a saved view'

/** Why a view given as a camera holds a key a camera does not take, or a lens or a zoom that is none; or null. */
export const cameraKeys = (view: unknown): string | null => {
  if (view === undefined || typeof view === 'string') return null
  // The schema lets anything through, so that what is no camera is answered with what one is (`loose`).
  const point = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c))
  const said = view as { position?: unknown; target?: unknown; up?: unknown; ortho?: unknown } | null
  if (typeof said !== 'object' || said === null || Array.isArray(said) || !point(said.position) || !point(said.target)) return NO_CAMERA
  if ((said.up !== undefined && !point(said.up)) || (said.ortho !== undefined && typeof said.ortho !== 'boolean')) return NO_CAMERA
  const wrong = unknownKeys(view, CAMERA_KEYS, 'view, as a camera,')
  if (wrong !== null) return wrong
  const { fov, zoom } = view as { fov?: number; zoom?: number }
  if (zoom !== undefined && !(Number.isFinite(zoom) && zoom > 0)) return 'view, as a camera, takes a zoom above 0 (1 is not zoomed), as scene gives it'
  if (fov !== undefined && !(Number.isFinite(fov) && fov >= 1 && fov <= 120)) return 'view, as a camera, takes a fov between 1 and 120 degrees, as scene gives it'
  return null
}

/**
 * `marks` are the object's, when they could be read: the unresolved
 * dimensions that have an expected value are then counted by how they stand
 * on the last build, so that the check after an edit says at once whether
 * the person's checks still hold. `scans` are the object's, when they could
 * be read: each is named, with whether it is aligned in the layout the answer
 * is for (the one on screen, else the first). `views` are the views saved
 * of the object, when its scene file could be read: each is listed with
 * whose it is and what it holds.
 */
type ScenePart = Scene['parts'][number]
export interface SceneArgs { layout?: string }
/** The named sets of the object, when they could be read, and the build each one's refs are of, by set id (none for a set: not since torno opened the project). */
export interface NamedSets {
  sets: readonly NamedSet[]
  refs: Readonly<Record<string, number>> | undefined
}
/** The most parts `scene` lists in full, and the most characters their list may take (Claude Code saves a result over 50,000 to a file). */
const SCENE_PARTS = 200
const SCENE_CHARS = 30_000

export function sceneTool(deps: ToolDeps, objectId: string, marks?: readonly Mark[], scans?: readonly ScanInfo[], views?: readonly SavedView[], args: SceneArgs = {}, named?: NamedSets): ToolResult {
  const found = built(deps, objectId)
  if ('content' in found) {
    // The first build failed: nothing was built, and what the model printed is all there is besides the error.
    const printed = modelOutput(deps, objectId)
    return printed ? { ...found, content: [...found.content, { type: 'text', text: `output of the model${printed.cut ? ' (earlier output cut)' : ''}:\n${printed.text}` }] } : found
  }
  const { obj, build, scene, revision } = found
  const asked = args.layout
  if (asked !== undefined && !scene.layouts.includes(asked)) return failure(`no layout '${asked}'; layouts: ${scene.layouts.join(', ') || 'none'}`)
  const checks = (marks ?? []).filter((m): m is DimensionMark => m.kind === 'dimension' && m.status !== 'resolved').map((m) => standingOf(m, revision)).filter((stands) => stands !== 'measured')
  const count = (...of: DimensionStanding[]): number => checks.filter((stands) => of.includes(stands)).length

  const open = deps.openObjectId() === objectId
  const view = open ? deps.view(objectId) : undefined
  // Layers are switched by part name, in every layout at once; the view names the keys of the layout shown.
  const shown = view && new Set(view.visible.map((key) => scene.parts.find((p) => p.key === key)?.name))
  const hideable = view && new Set(scene.parts.filter((p) => p.layout === view.layout).map((p) => p.name))

  const error = build.error && {
    kind: build.error.kind,
    message: build.error.message,
    ...(build.error.traceback ? { traceback: lastLines(build.error.traceback, TRACEBACK_LINES) } : {}),
    // Why a fillet or a chamfer failed: the kernel's data, and the same in words.
    ...(build.error.diagnosis ? { diagnosis: { ...build.error.diagnosis, reading: diagnosisText(build.error.diagnosis) } } : {})
  }
  // What the model printed in the build that ended last (the failed one when the last failed): its tail, as `buildContextFor` tells it.
  const printed = modelOutput(deps, objectId)
  const notes: string[] = []
  if (!open) notes.push(`${notOpen(obj, deps.openObjectId())}, so what is visible, the camera and the section are not known.`)
  const letGo = letGoText(build)
  if (letGo) notes.push(letGo)
  if (scene.parts.some((p) => p.arranged)) notes.push(SPREAD_NOTE)
  if (scene.parts.some((p) => p.role === 'reference')) notes.push(REFERENCE_NOTE)
  const scanLayout = view && scene.layouts.includes(view.layout) ? view.layout : scene.layouts[0]
  if (scans && scans.length > 0) notes.push(`How each scan is aligned is said for layout ${scanLayout}, in a word (aligned, rough, in doubt, not checked, not aligned): call scans for the whole of it.`)
  // The parts are drawn apart on their screen: said, so that nothing told here is taken for where they are drawn.
  const explode = view && isExploded(view.explode) ? view.explode : null
  if (explode) notes.push(`The user's view is ${explodeText(explode)}: ${EXPLODED_NOTE}.`)
  if (scene.parts.some((p) => p.bboxExact !== true || p.volumeExact !== true)) notes.push(APPROXIMATE_NOTE)
  if (scene.parts.some((p) => p.reversed && p.reversed.length > 0)) notes.push(REVERSED_NOTE)
  if (scene.parts.some((p) => (p.openShells ?? 0) > 0)) notes.push(OPEN_NOTE)
  if (scene.parts.some((p) => p.meshDisagrees === true)) notes.push(MESH_NOTE)
  // The model's groups of parts, in the layout shown (or the first): each with its parts there, and how many are on.
  const groupLayout = view && scene.layouts.includes(view.layout) ? view.layout : scene.layouts[0]
  const groups = groupLayout === undefined ? [] : groupsIn(scene, groupLayout).map((group) => ({
    name: group.name,
    parts: group.parts,
    ...(shown ? { visible: groupVisibility(group.parts, Object.fromEntries(group.parts.map((name) => [name, { visible: shown.has(name) }]))) } : {})
  }))
  // The parts of one layout are listed: the one asked for, else the one on screen, else the first; the others are counted.
  const partsLayout = asked ?? (view && scene.layouts.includes(view.layout) ? view.layout : scene.layouts[0])
  const inLayout = scene.parts.filter((p) => p.layout === partsLayout)
  const elsewhere: Record<string, number> = {}
  for (const p of scene.parts) if (p.layout !== partsLayout) elsewhere[p.layout] = (elsewhere[p.layout] ?? 0) + 1

  const full = (p: ScenePart): object => ({
    name: p.name,
    layout: p.layout,
    ...(groupOf(scene, p.name) ? { group: groupOf(scene, p.name)!.name } : {}),
    ...(p.role === 'reference' ? { role: 'reference' } : {}),
    // A part with no namesake in the layout shown has not been seen to be switched off.
    ...(shown && hideable ? { visible: shown.has(p.name) || !hideable.has(p.name) } : {}),
    size: p.bbox.max.map((max, i) => round(max - p.bbox.min[i])),
    // Exact only where the kernel says so: nothing is claimed of a part it said nothing of.
    sizeExact: p.bboxExact === true,
    bbox: { min: p.bbox.min.map(round), max: p.bbox.max.map(round) },
    volume: round(p.volume),
    volumeExact: p.volumeExact === true,
    faces: p.faceCount,
    edges: p.edgeCount,
    valid: p.valid,
    ...(p.reversed && p.reversed.length > 0 ? { reversed: p.reversed } : {}),
    ...(p.solids !== undefined ? { solids: p.solids } : {}),
    ...((p.openShells ?? 0) > 0 ? { openShells: p.openShells } : {}),
    // What the mesh encloses only where it is a warning: never a number to rely on.
    ...(p.meshDisagrees === true && p.meshVolume !== undefined ? { meshVolume: round(p.meshVolume), meshDisagrees: true } : {}),
    ...(p.arranged ? { arranged: p.arranged.map(round) } : {}),
    // The names the model gives its faces and edges (`part/@tag`), with the refs they are now.
    ...(p.tags && Object.keys(p.tags).length > 0 ? { tags: Object.fromEntries(Object.keys(p.tags).map((tag) => [tag, tagRefs(p, tag)])) } : {})
  })
  // Past SCENE_PARTS parts, or when the full list would not fit, each part is its name, size and group: describe gives the rest.
  const compact = (p: ScenePart): object => ({
    name: p.name,
    layout: p.layout,
    ...(groupOf(scene, p.name) ? { group: groupOf(scene, p.name)!.name } : {}),
    ...(p.role === 'reference' ? { role: 'reference' } : {}),
    size: p.bbox.max.map((max, i) => round(max - p.bbox.min[i])),
    sizeExact: p.bboxExact === true,
    ...(p.reversed && p.reversed.length > 0 ? { reversed: p.reversed } : {}),
    ...((p.openShells ?? 0) > 0 ? { openShells: p.openShells } : {}),
    ...(p.meshDisagrees === true ? { meshDisagrees: true } : {}),
    ...(p.tags && Object.keys(p.tags).length > 0 ? { tags: Object.keys(p.tags) } : {})
  })
  const fits = (list: readonly object[]): boolean => JSON.stringify(list).length <= SCENE_CHARS
  const detailed = inLayout.length > SCENE_PARTS ? null : inLayout.map(full)
  const listing: { parts: object[]; extra: object } = detailed && fits(detailed)
    ? { parts: detailed, extra: {} }
    : { parts: inLayout.map(compact), extra: { partsTruncated: true, partsOmitted: 'volume, face and edge counts, solids and their warnings, the box; call describe with a part name for them' } }
  Object.assign(listing.extra, { partsLayout: partsLayout ?? null }, Object.keys(elsewhere).length > 0 ? { partsInOtherLayouts: elsewhere, partsNote: 'The parts of the other layouts are counted here, not listed: call scene with layout to list them.' } : {})
  const expected = deps.expectations?.last(objectId)
  const result = {
    object: obj.id,
    model: scene.model,
    build: {
      status: build.status,
      revision: build.revision,
      ...(build.seconds === undefined ? {} : { seconds: round(build.seconds) }),
      stale: build.stale,
      ...(build.letGo ? { letGo: build.letGo } : {}),
      ...(error ? { error } : {})
    },
    ...(printed ? { output: printed.text, ...(printed.cut ? { outputCut: true } : {}) } : {}),
    layout: view?.layout ?? null,
    layouts: scene.layouts,
    // The files the model imported from outside its folder (another project's, common/): a save in one builds this project again.
    ...(scene.uses && scene.uses.length > 0 ? { uses: scene.uses } : {}),
    // The model's Params as the kernel read them from the source: read only, the model file is the user's.
    params: scene.params ?? [],
    // The person's overrides of those Params this build was made with (value differs from default), and those let go of.
    ...(scene.overrides && (Object.keys(scene.overrides.applied).length > 0 || scene.overrides.dropped.length > 0) ? { paramsTried: scene.overrides } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    // The person's named sets (`#deck`), in every layout: each with its members by ref and how many the last build lost.
    ...(named && named.sets.length > 0 ? { sets: setsListed(named.sets, marks ?? [], revision, named.refs) } : {}),
    parts: listing.parts,
    ...(listing.extra),
    camera: view
      ? { ...view.camera, position: view.camera.position.map(round), target: view.camera.target.map(round), up: view.camera.up.map(round) }
      : null,
    // The user's own cut, if they have one: what is on the side its normal points to is not drawn.
    section: view?.section ? sectionData(view.section) : null,
    // How their screen draws the parts apart, if it does. For display only: every part above is where it was built.
    explode,
    // What the agent expected of an edit and how the build after it stood: told once with the edit, kept here.
    ...(expected ? { expect: { revision: expected.revision, met: expected.met, notMet: expected.missed, ...(expected.note ? { note: expected.note } : {}) } } : {}),
    // Of the last build that worked (`build.revision`): call marks for which, and why.
    ...(checks.length > 0 ? { dimensions: { pass: count('pass'), fail: count('fail'), notMeasured: count('unmeasured', 'unmeasurable') } } : {}),
    // The checks the model declares in checks(p), as the kernel measured them on this build: a pass is what was measured, never "verified".
    ...(scene.checks && scene.checks.length > 0 ? { checks: scene.checks.map(({ declared: _declared, ...c }) => c) } : {}),
    // The printer and material the person chose for the project: their numbers, which check and measure default to.
    ...(deps.profile?.(objectId) ? { printProfile: deps.profile(objectId) } : {}),
    ...(scene.checkNotes && scene.checkNotes.length > 0 ? { checksEasier: scene.checkNotes.map(noteText) } : {}),
    // How each alignment stands, not a bare yes: one that is rough, in doubt or was never checked against this build is not "aligned: true".
    ...(scans && scans.length > 0 ? { scans: scans.map((scan) => scanStanding(scan, scanLayout, revision)) } : {}),
    // The views saved by name: look and show take a name. One that is proposed is the agent's own, not yet kept by the user.
    ...(views && views.length > 0 ? { views: views.map(viewSummary) } : {}),
    ...(notes.length > 0 ? { note: notes.join(' ') } : {})
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

/** A scan as `scene` names it: with how its alignment in a layout stands, in a word, and what that rests on. */
function scanStanding(scan: ScanInfo, layout: string | undefined, revision: number): object {
  const said = layout === undefined ? null : alignmentSaid(scan, layout, revision)
  return { id: scan.id, name: scan.name, triangles: scan.imported.triangles, alignment: said?.state ?? 'not aligned', ...(said?.data.basis ? { basis: said.data.basis } : {}), ...(scan.meshState === 'ok' ? {} : { mesh: scan.meshState }) }
}

/** A section as the agent is told it: its point and its normal, and, when it is across an axis, also in the short form it may give one in. */
function sectionData(plane: SectionPlane): object {
  const along = axisForm(plane)
  return { origin: plane.origin.map(round), normal: tidy(plane.normal), ...(along && along.sign > 0 ? { axis: along.axis, at: round(along.at) } : {}) }
}

/**
 * What `lookTool` drew, for whoever asks for it (`capture`): the request, and the window's picture. A look that is
 * captured is not kept as a view of `.torno/views/`: it is kept by whoever asked for it.
 */
export interface LookCapture {
  request?: LookRequest
  picture?: LookResult
}

export async function lookTool(deps: ToolDeps, objectId: string, given: LookArgs, capture?: LookCapture): Promise<ToolResult> {
  const found = built(deps, objectId)
  if ('content' in found) return found
  const { obj, scene, revision } = found
  // The window draws whatever object it has open, and a request does not say
  // which is meant: asked for another, it would answer with the wrong one.
  const elsewhere = (open: string | null) => failure(`${notOpen(obj, open)}. Ask the user to open it.`)
  if (deps.openObjectId() !== objectId) return elsewhere(deps.openObjectId())
  if (given.margin !== undefined && given.focus === undefined) return failure(MARGIN_NEEDS_FOCUS)
  if (given.focus !== undefined && isSavedName(given.view)) return failure(NO_SAVED_FRAME)

  // The name of a saved view: the picture is of that view, whatever is on screen, but for what is given beside it.
  let args = given
  let named: NamedView | undefined
  if (isSavedName(given.view)) {
    const view = await namedView(deps, objectId, scene, given.view, { layout: given.layout, others: `current, ${STANDARD_VIEWS}` })
    if ('content' in view) return view
    named = view
    args = { ...given, ...besideView(view, given, Boolean(deps.view(objectId)?.section)), ...(given.scans === undefined && view.scans ? { scans: view.scans } : {}) }
  }

  const wrong = cameraKeys(args.view)
  if (wrong !== null) return failure(wrong)
  const view = cameraOf(args.view)
  if (view === null) return failure('position and target are the same')
  const request: LookRequest = { view, size: clampSize(args.size, deps.lookSize) }
  if (named) request.viewName = named.view.name
  if (args.layout !== undefined) request.layout = args.layout
  if (args.parts !== undefined) {
    const parts = partsOf(scene, args.layout ?? deps.view(objectId)?.layout, args.parts)
    if ('content' in parts) return parts
    request.parts = parts.names
  }
  if (args.marks !== undefined) request.marks = args.marks
  if (args.section === null || args.section === 'current') request.section = args.section
  else if (args.section !== undefined) {
    const plane = planeArg(args.section)
    if ('content' in plane) return plane
    request.section = plane
  }
  if (args.scans === false) request.scans = false
  else if (args.scans !== undefined && args.scans !== true) {
    const ids = await scanIds(deps, objectId, args.scans, NO_LOOK_SCANS)
    if ('content' in ids) return ids
    request.scans = ids
  }
  if (args.scanColour !== undefined) {
    const colouring = await scanColourFor(deps, objectId, scene, revision, args.layout, args.scanColour)
    if ('content' in colouring) return colouring
    request.scanColour = colouring
  }
  // As on screen unless the picture says how far apart it draws the parts; never apart and cut.
  const explode = explodeAsked(args.explode)
  if (typeof explode === 'string') return failure(explode)
  request.explode = explode === undefined ? 'current' : explode
  if (isExploded(explode) && (args.section === undefined || args.section === 'current' ? deps.view(objectId)?.section : args.section)) return failure(NOT_EXPLODED_AND_CUT)
  // Asked apart where nothing can be: said, not passed over with a picture of the parts together.
  const nothing = drawsNothingApart(scene, args.layout ?? deps.view(objectId)?.layout, explode)
  if (nothing !== null) return failure(nothing)
  if (args.frame !== undefined) {
    if (args.frame !== 'parts' && args.frame !== 'all') return failure('frame is "parts" (the default: a named view is fitted to the parts drawn) or "all" (to the scans drawn with them)')
    request.frame = args.frame
  }
  // A focus: the box the picture is framed on, worked out here against the last build. It is where the parts are built, so they are drawn together.
  let focused: Focused | undefined
  if (given.focus !== undefined) {
    if (isExploded(explode)) return failure(FOCUS_NOT_EXPLODED)
    const got = await focusing(deps, objectId, found, args, request.parts)
    if ('content' in got) return got
    focused = got
    request.focus = got.focus
    request.explode = null
  }

  let picture: LookResult
  try {
    picture = await deps.look(objectId, request)
  } catch (e) {
    return failure(e instanceof Error ? e.message : String(e))
  }
  // The picture says what it is of: the window may have moved on, or a build
  // may have ended, between the request and the answer, and what main knows
  // now is not what was drawn.
  if (picture.objectId !== objectId) return elsewhere(picture.objectId)

  if (capture) {
    capture.request = request
    capture.picture = picture
  }
  let saved: string
  try {
    saved = capture ? 'not kept as a view' : `saved as ${await deps.saveImage(objectId, picture.png)}`
  } catch (e) {
    saved = `not saved: ${e instanceof Error ? e.message : String(e)}`
  }
  return {
    content: [
      { type: 'image', data: Buffer.from(picture.png).toString('base64'), mimeType: 'image/png' },
      { type: 'text', text: `${picture.caption}${named ? passedOver(named, given, { picture: true, cut: Boolean(deps.view(objectId)?.section) }) : ''}${spreadBesideScans(scene, picture)}${await undrawnScans(deps, objectId, args.scans === false ? [] : Array.isArray(args.scans) ? args.scans : undefined)}${focused ? `${focusSaid(focused)}${hiddenText(picture.hiddenBy)}${given.explode === undefined && isExploded(deps.view(objectId)?.explode) ? "\nThe user's screen draws the parts apart; this picture draws them together, as a focus is where they are built." : ''}` : ''}\nrevision r${picture.revision}${staleNote(deps, objectId, picture)}\n${saved}` }
    ]
  }
}

/** The focus checked against the last build, and the layout it is in: its box, or why it cannot be framed. For `look` and `show`; `drawn` is the parts the call names, if it does. */
async function focusing(deps: ToolDeps, objectId: string, found: { scene: Scene; revision: number }, args: { focus?: unknown; margin?: unknown; layout?: string }, drawn: string[] | undefined): Promise<Focused | ToolResult> {
  const share = marginShare(args.margin)
  if (typeof share !== 'number') return share
  const layout = layoutFor(deps, objectId, found.scene, args.layout)
  if (typeof layout !== 'string') return layout
  const screen = deps.view(objectId)
  return focusOf(deps, objectId, found, layout, args.focus, share, (parts) => notDrawn(parts, layout, drawn, screen ? { layout: screen.layout, visible: screen.visible } : undefined))
}

/** What a reply says of the focus, after the caption: what was framed and how, and what torno moved. */
const focusSaid = (focused: Focused): string => `\n${focused.said}.${focused.moved ? `\n${focused.moved}` : ''}`

/**
 * Said once after the caption of a picture, or of what the window shows, that draws a scan in a layout whose
 * parts torno spread for display: the scan stands where the model's frame has it, and the parts torno moved do
 * not. The picture shows a lid inside a wing, and whoever reads it must know that is torno's doing. '' otherwise.
 */
export function spreadBesideScans(scene: Scene, shown: { layout?: string; scans?: string[] }): string {
  if (!shown.layout || !shown.scans?.length) return ''
  const parts = scene.parts.filter((part) => part.layout === shown.layout)
  const moved = parts.filter((part) => part.arranged?.some((c) => Math.abs(c) > 1e-6)).map((part) => part.name)
  if (moved.length === 0) return ''
  const still = parts.filter((part) => !moved.includes(part.name)).map((part) => part.name)
  return `\nThe parts of layout ${shown.layout} were spread for display: ${moved.join(', ')} ${moved.length === 1 ? 'is' : 'are'} not where ${shown.scans.join(', ')} ${shown.scans.length === 1 ? 'has' : 'have'} ${moved.length === 1 ? 'it' : 'them'}${still.length > 0 ? ` (${still.join(', ')} ${still.length === 1 ? 'is' : 'are'} where the model places ${still.length === 1 ? 'it' : 'them'})` : ''}.`
}

/** Said of the scans that are not in a picture because their mesh is gone from the disk: of those asked for, or of all when none was named. '' when the scans cannot be read, or none is so. */
async function undrawnScans(deps: ToolDeps, objectId: string, asked: string[] | undefined): Promise<string> {
  const scans = await deps.scans(objectId).catch(() => [] as ScanInfo[])
  const gone = scans.filter((scan) => scan.meshState !== 'ok' && (asked === undefined || asked.includes(scan.id))).map((scan) => scan.id)
  return gone.length === 0 ? '' : `\n${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} not drawn: ${gone.length === 1 ? 'its mesh is' : 'their meshes are'} gone from the disk (the user imports ${gone.length === 1 ? 'it' : 'them'} again from the Scans section).`
}

/** What to say after the revision of a picture whose parts are not the latest build's. '' when they are. */
function staleNote(deps: ToolDeps, objectId: string, picture: { revision: number; stale: boolean }): string {
  const latest = deps.scene(objectId)?.revision ?? picture.revision
  if (latest > picture.revision) return `, stale: r${latest} was built while this picture was made; look again to see it`
  if (!picture.stale) return ''
  const status = deps.build(objectId)?.status
  const why = status === 'building' ? 'a build is running' : status === 'failed' ? 'the latest build failed' : 'a newer build was started'
  return `, stale: ${why}, so these are still the parts of r${picture.revision}`
}

/**
 * How far apart the agent asks for the parts to be drawn: undefined when it does not say, null for together
 * (`null`, the number 0, or an amount of 0), an explode, or what to answer when it gave something that is none.
 * Nothing is made of what is nearly one: a number or an amount outside 0 to 1 (a percentage), a scale outside its
 * range, an axis that is none and a key that is not taken are each refused, with what an explode is. For
 * whatever takes an explode from the agent: `look`, `show`, `save_view`.
 */
export function explodeAsked(given: unknown): ExplodeState | null | undefined | string {
  if (given === undefined) return undefined
  if (given === null) return null
  const wrong = unknownKeys(given, ['amount', 'scale', 'axis'], 'explode')
  if (wrong !== null) return wrong
  const help = `explode is ${explodeHelp}`
  const said = (typeof given === 'number' ? { amount: given } : given) as { amount?: unknown; scale?: unknown; axis?: unknown }
  const explode = explodeArg(given)
  // As given, or not at all: what `explodeOf` would bring into range for a file is refused here.
  if (explode === null || explode.amount !== said.amount) return help
  if (said.scale !== undefined && explode.scale !== said.scale) return help
  if (said.axis !== undefined && explode.axis !== said.axis) return help
  return isExploded(explode) ? explode : null
}

/** Why an explode the agent asked for would draw nothing apart in a layout of the scene, as the answer to give; null when it would, or when the layout is none (whoever draws it says so). */
function drawsNothingApart(scene: Scene, layout: string | undefined, explode: ExplodeState | null | undefined): string | null {
  if (!isExploded(explode) || layout === undefined || !scene.layouts.includes(layout)) return null
  const why = nothingApart(explode, scene.parts.filter((part) => part.layout === layout))
  return why === null ? null : nothingApartText(why, layout)
}

/** The camera to ask the window for, or null for one that looks nowhere: its position is its target. */
export function cameraOf(view: LookArgs['view']): NonNullable<LookRequest['view']> | null {
  if (view === undefined) return 'current'
  // The name of a saved view never comes this far: whoever takes one has made a camera of it (`namedView`).
  if (typeof view === 'string') return view as 'current' | ViewName
  const along = view.position.map((p, i) => view.target[i] - p)
  if (along.every((d) => d === 0)) return null
  // Looking straight up or down, Z cannot be up: Y is.
  const vertical = along[0] === 0 && along[1] === 0
  const made: Camera = { position: view.position, target: view.target, up: view.up ?? (vertical ? [0, 1, 0] : [0, 0, 1]), ortho: view.ortho ?? false, fov: view.fov ?? FOV, zoom: view.zoom ?? 1 }
  return made
}

export async function showTool(deps: ToolDeps, objectId: string, given: ShowArgs): Promise<ToolResult> {
  const found = onScreen(deps, objectId)
  if ('content' in found) return found
  const { obj, scene } = found
  if (given.margin !== undefined && given.focus === undefined) return failure(MARGIN_NEEDS_FOCUS)
  if (given.view === undefined && given.focus === undefined && given.layout === undefined && given.parts === undefined && given.section === undefined && given.scans === undefined && given.scanOpacity === undefined && given.explode === undefined) return failure('nothing to show: give a view, a focus, a layout, parts, a section, an explode or scans')
  if (given.focus !== undefined && isSavedName(given.view)) return failure(NO_SAVED_FRAME)
  if (given.layout !== undefined && !scene.layouts.includes(given.layout)) return failure(`no layout '${given.layout}'; layouts: ${scene.layouts.join(', ')}`)
  if (given.parts?.length === 0) return failure('parts is empty: name the parts to leave switched on')
  if (given.view === 'current') return failure(`view "current" is the camera the user has, which stays unless you give another: ${STANDARD_VIEWS}, the name of a saved view, or a camera`)

  // The name of a saved view: all of it is put on their screen, for now, but for what is given beside it.
  let args = given
  let named: NamedView | undefined
  if (isSavedName(given.view)) {
    const view = await namedView(deps, objectId, scene, given.view, { layout: given.layout, others: STANDARD_VIEWS })
    if ('content' in view) return view
    named = view
    args = { ...given, ...besideView(view, given) }
  }

  const request: ShowRequest = { objectId }
  if (named) request.viewName = named.view.name
  // How the view has each scan, unless the call says which scans it wants or how thin.
  if (named?.scanViews && given.scans === undefined && given.scanOpacity === undefined) request.scanViews = named.scanViews
  if (args.view !== undefined) {
    const wrong = cameraKeys(args.view)
    if (wrong !== null) return failure(wrong)
    const view = cameraOf(args.view)
    if (view === null) return failure('position and target are the same')
    if (view !== 'current') request.view = view
  }
  if (args.layout !== undefined) request.layout = args.layout
  if (args.parts !== undefined) {
    const parts = partsOf(scene, args.layout ?? deps.view(objectId)?.layout, args.parts)
    if ('content' in parts) return parts
    request.parts = parts.names
  }
  if (args.section === null) request.section = null
  else if (args.section !== undefined) {
    const plane = planeArg(args.section)
    if ('content' in plane) return plane
    request.section = plane
  }
  const explode = explodeAsked(args.explode)
  if (typeof explode === 'string') return failure(explode)
  if (explode !== undefined) request.explode = explode
  // Never apart and cut: the cut this call makes, or the one on their screen unless this call takes it away.
  if (isExploded(explode) && (args.section === undefined ? deps.view(objectId)?.section : args.section)) return failure(NOT_EXPLODED_AND_CUT)
  const nothing = drawsNothingApart(scene, args.layout ?? deps.view(objectId)?.layout, explode)
  if (nothing !== null) return failure(nothing)
  // A focus is where the parts are built: not where they are drawn apart, by this call or as the user has them.
  let focused: Focused | undefined
  if (given.focus !== undefined) {
    if (explode === undefined ? isExploded(deps.view(objectId)?.explode) : isExploded(explode)) return failure(FOCUS_NOT_EXPLODED)
    const got = await focusing(deps, objectId, found, args, request.parts)
    if ('content' in got) return got
    focused = got
    request.focus = got.focus
  }
  if (args.scans !== undefined) {
    const ids = await scanIds(deps, objectId, args.scans, NO_SHOW_SCANS)
    if ('content' in ids) return ids
    request.scans = ids
  }
  if (args.scanOpacity !== undefined) {
    if (!isScanOpacity(args.scanOpacity)) return failure(NO_SCAN_OPACITY)
    request.scanOpacity = args.scanOpacity
  }

  let shown: ShowResult
  try {
    shown = await deps.show(objectId, request)
  } catch (e) {
    return failure(messageOf(e))
  }
  if (shown.objectId !== objectId) return failure(`${notOpen(obj, shown.objectId)}. Ask the user to open it.`)
  return { content: [{ type: 'text', text: `${shown.caption}${named ? passedOver(named, given) : ''}${spreadBesideScans(scene, shown)}${await undrawnScans(deps, objectId, args.scans)}${focused ? focusSaid(focused) : ''}\nrevision r${shown.revision}${staleNote(deps, objectId, shown)}\nThe user's viewport now shows this.` }] }
}

const STANDARD_VIEWS = 'iso, front, back, left, right, top, bottom'

/**
 * Part or group names, as the agent gives them, to the part names of the layout they are of (`partsNamed`): a group
 * stands for its parts there. With no layout known (the window has not said which it shows) they go as given, and
 * the window expands them by the same rule.
 */
function partsOf(scene: Scene, layout: string | undefined, names: string[]): { names: string[] } | ToolResult {
  if (layout === undefined || !scene.layouts.includes(layout)) return { names }
  const parts = partsNamed(scene, layout, names)
  return Array.isArray(parts) ? { names: parts } : failure(parts.text)
}

/** Whether a view given as a text is the name of a saved view: any text that is neither `current` nor a standard view. */
const isSavedName = (view: unknown): view is string => typeof view === 'string' && view !== 'current' && !(VIEW_NAMES as readonly string[]).includes(view)

/** A saved view as a picture or the window is asked for it, and what of it was passed over, each as it is said. */
interface NamedView {
  view: SavedView
  /** The layout it is drawn in: its own, or the one asked beside it. */
  layout: string
  /** The names of the parts it shows: every part of that layout the build has, but those it hides. */
  parts: string[]
  /** How far apart it draws them, or null: also when it holds an explode that would draw nothing apart now. */
  explode: ExplodeState | null
  /** The scans a picture of it draws, by id: those it switches on, and of those it says nothing of, those on screen. Absent when it says nothing of the scans, or they cannot be read. */
  scans?: string[]
  /** How it has each scan the object still has. */
  scanViews?: NonNullable<SavedView['scans']>
  /** What it names that is gone, or holds that cannot be drawn now, by what it is of; `thin`: the scans a picture draws as thin as the screen has them, where the view has them otherwise. */
  passed: { parts?: string; scans?: string; explode?: string; thin?: string }
}

/**
 * What a saved view asks of a picture or of the window: its camera, layout, the parts it shows (every part of its
 * layout the build has, but its hidden ones), its section or its explode, its scans. Or the error to answer with:
 * no view of that name, listing the names there are, or a view of a layout the model no longer has. Parts and
 * scans it names that are gone are passed over, and said (`passed`): a view is never applied in silence to
 * something else than it was saved of. `asked.layout` is the layout asked for beside it, which wins over its own;
 * `asked.others` what else a view may be given as, for the refusal.
 */
export async function namedView(deps: ToolDeps, objectId: string, scene: Scene, name: string, asked: { layout?: string; others?: string } = {}): Promise<NamedView | ToolResult> {
  // A scene file that cannot be read has no views.
  const views = await deps.views(objectId).catch(() => [] as SavedView[])
  const view = findView(views, name)
  const others = asked.others ?? `current, ${STANDARD_VIEWS}`
  if (!view) return failure(views.length > 0 ? `no view "${name}": the saved views are ${views.map((one) => `"${one.name}"`).join(', ')}; or ${others}, or a camera` : `no view "${name}": there are no saved views; give ${others}, or a camera`)
  const layout = asked.layout ?? view.layout
  if (!scene.layouts.includes(layout)) return failure(asked.layout === undefined ? `the view "${view.name}" is of layout ${view.layout}, which the model no longer has (layouts: ${scene.layouts.join(', ')})` : `no layout '${layout}'; layouts: ${scene.layouts.join(', ')}`)
  const inLayout = scene.parts.filter((part) => part.layout === layout)
  const names = inLayout.map((part) => part.name)
  // Not read: nothing is then asked of the scans, and nothing said of them.
  const scans = view.scans ? await deps.scans(objectId).catch(() => undefined) : undefined
  const gone = viewGone({ ...view, layout }, { layouts: scene.layouts, parts: names, ...(scans ? { scans: scans.map((scan) => scan.id) } : {}) })
  const passed: NamedView['passed'] = {}
  if (gone.parts.length > 0) passed.parts = `the part${gone.parts.length === 1 ? '' : 's'} ${gone.parts.join(', ')}, which layout ${layout} no longer has`
  if (gone.scans.length > 0) passed.scans = `the scan${gone.scans.length === 1 ? '' : 's'} ${gone.scans.join(', ')}, which ${gone.scans.length === 1 ? 'is' : 'are'} gone`
  // Saved apart, of parts that can no longer be drawn apart: drawn together, and said.
  const nothing = view.explode ? nothingApart(view.explode, inLayout) : null
  if (nothing !== null) passed.explode = `its explode, as layout ${layout} ${nothing === 'one part' ? 'has fewer than two parts now' : 'has parts that share a centre now'}`
  const named: NamedView = { view, layout, parts: names.filter((part) => !view.hidden.includes(part)), explode: nothing === null ? (view.explode ?? null) : null, passed }
  if (view.scans && scans) {
    const onScreen = deps.view(objectId)?.scans
    const has = view.scans
    named.scans = scans.filter((scan) => (scan.id in has ? has[scan.id].visible !== false : onScreen?.find((one) => one.id === scan.id)?.visible !== false)).map((scan) => scan.id)
    named.scanViews = Object.fromEntries(Object.entries(has).filter(([id]) => scans.some((scan) => scan.id === id)))
    // A picture draws a scan as thin as the screen has it: where the view has it otherwise, that is said.
    const thin = (opacity: number): string => (opacity >= 1 ? 'solid' : `${number(opacity * 100)} %`)
    const other = named.scans.filter((id) => id in has && onScreen && (has[id].opacity ?? 1) !== (onScreen.find((one) => one.id === id)?.opacity ?? 1)).map((id) => `${id} (${thin(has[id].opacity ?? 1)})`)
    if (other.length > 0) passed.thin = `how thin it has ${other.length === 1 ? other[0] : `${other.slice(0, -1).join(', ')} and ${other.at(-1)}`}, which ${other.length === 1 ? 'is' : 'are'} drawn as thin as the user's screen has ${other.length === 1 ? 'it' : 'them'}`
  }
  return named
}

/**
 * What a call that names a saved view asks for, of what a view holds: the view's own, but what the call gives
 * beside it. A view holds a section or an explode, never both, so one given beside it takes the place of the
 * other: a cut given leaves the parts together, and parts asked apart are drawn whole.
 */
function besideView(named: NamedView, given: { layout?: string; parts?: string[]; section?: unknown; explode?: unknown }, screenCut = false): { view: CameraArg; layout: string; parts: string[]; section?: never; explode?: never } {
  const apart = explodeAsked(given.explode)
  return {
    view: named.view.camera,
    layout: named.layout,
    parts: given.parts ?? named.parts,
    ...(given.section === undefined ? { section: isExploded(apart as ExplodeState | null | undefined) ? null : (named.view.section ?? null) } : {}),
    ...(given.explode === undefined ? { explode: cutBeside(given.section, screenCut) ? null : named.explode } : {})
  } as { view: CameraArg; layout: string; parts: string[] }
}

/** Whether a section given beside a view cuts: a plane does; `'current'`, the user's own, only when they have one. */
const cutBeside = (section: unknown, screenCut: boolean): boolean => (section === 'current' ? screenCut : section !== undefined && section !== null)

/**
 * Said after the caption of a picture, or of what the window shows, of a saved view: what the view names or
 * holds that was passed over, but what the call itself gave instead. Of a picture (`of.picture`), also the scans
 * drawn as thin as the screen has them where the view has them otherwise, and the view's explode when the
 * picture is cut by the user's own section (`of.cut`: they have one). '' for nothing.
 */
function passedOver(named: NamedView, given: { parts?: unknown; scans?: unknown; scanOpacity?: unknown; explode?: unknown; section?: unknown }, of: { picture?: boolean; cut?: boolean } = {}): string {
  const theirScans = given.scans === undefined && given.scanOpacity === undefined
  const said = [
    given.parts === undefined ? named.passed.parts : undefined,
    theirScans ? named.passed.scans : undefined,
    given.explode === undefined && (given.section === undefined || given.section === null) ? named.passed.explode : undefined,
    given.explode === undefined && given.section === 'current' && of.cut && named.explode ? "its explode, as the picture is cut by the user's section" : undefined,
    of.picture && theirScans ? named.passed.thin : undefined
  ].filter((one) => one !== undefined)
  return said.length === 0 ? '' : ` · passed over, of the view "${named.view.name}": ${said.join('; ')}`
}

const NO_VIEW_NAME = 'name is what the view is called, 1 to 40 characters: {"name": "Wall at the latch"}'

/**
 * Leaves the user a view the agent proposes: kept by the window among the saved views of the object it shows, as
 * the agent's and proposed until the user keeps or discards it. Whose it is and that it is proposed are never an
 * argument. Everything is checked here first, against the views main knows of and the last build; the window
 * checks again, against what it has, and its refusal is the answer. Nothing on the user's screen changes.
 */
export async function saveViewTool(deps: ToolDeps, objectId: string, args: SaveViewArgs): Promise<ToolResult> {
  const found = onScreen(deps, objectId)
  if ('content' in found) return found
  const { obj, scene } = found
  if (typeof args.name !== 'string') return failure(NO_VIEW_NAME)
  if (args.note !== undefined && typeof args.note !== 'string') return failure('note is why you propose the view, in a line: {"name": "Wall at the latch", "note": "the wall M7 is about"}')
  const views = await deps.views(objectId).catch(() => [] as SavedView[])
  const refused = viewNameRefusal(args.name, views, 'agent')
  // A name the user has: theirs are named, so that the next one asked is free.
  if (refused !== null) return failure(refused.startsWith('the user ') ? `${refused} (their views: ${views.filter((view) => !view.proposed).map((view) => `"${view.name}"`).join(', ')})` : refused)
  if (args.layout !== undefined && !scene.layouts.includes(args.layout)) return failure(`no layout '${args.layout}'; layouts: ${scene.layouts.join(', ')}`)
  const layout = args.layout ?? deps.view(objectId)?.layout
  // Group names stand for their parts: the view is saved with part names, and outlives a group's removal.
  let parts = args.parts
  if (parts !== undefined) {
    const named = partsOf(scene, layout, parts)
    if ('content' in named) return named
    parts = named.names
  }

  const request: SaveViewRequest = { objectId, name: cleanViewName(args.name) }
  if (args.note !== undefined) request.note = args.note
  if (args.view !== undefined) {
    if (typeof args.view === 'string' && !(VIEW_NAMES as readonly string[]).includes(args.view)) return failure("view is iso, front, back, left, right, top or bottom, or a camera as scene gives one; left out, it is the camera on the user's screen")
    const wrong = cameraKeys(args.view)
    if (wrong !== null) return failure(wrong)
    const view = cameraOf(args.view)
    if (view === null) return failure('position and target are the same')
    request.view = view as ViewName | Camera
  }
  if (args.layout !== undefined) request.layout = args.layout
  if (parts !== undefined) request.parts = parts
  if (args.section === null) request.section = null
  else if (args.section !== undefined) {
    const plane = planeArg(args.section)
    if ('content' in plane) return plane
    request.section = plane
  }
  const explode = explodeAsked(args.explode)
  if (typeof explode === 'string') return failure(explode)
  if (explode !== undefined) request.explode = explode
  if (isExploded(explode) && request.section) return failure(VIEW_NOT_BOTH)
  const nothing = drawsNothingApart(scene, layout, explode)
  if (nothing !== null) return failure(nothing)

  let saved: SaveViewResult
  try {
    saved = await deps.saveView(objectId, request)
  } catch (e) {
    return failure(messageOf(e))
  }
  if (saved.objectId !== objectId) return failure(`${notOpen(obj, saved.objectId)}. Ask the user to open it.`)
  const { view } = saved
  const shown = scene.parts.filter((part) => part.layout === view.layout && !view.hidden.includes(part.name)).map((part) => part.name)
  const holds = view.section ? `section ${planeText(view.section)}, ` : view.explode ? `${explodeText(view.explode)}, ` : ''
  const dropped = saved.dropped === undefined ? '' : ` Your oldest proposal, "${saved.dropped}", was dropped to make room: a project holds ${MAX_PROPOSALS} proposals at most.`
  return { content: [{ type: 'text', text: `saved "${view.name}" as a view you propose${saved.replaced ? ', in place of your earlier proposal of that name' : ''}: layout ${view.layout}, parts ${shown.join(', ') || 'none'}, ${holds}${view.camera.ortho ? 'orthographic' : 'perspective'}. The user sees it in their views, marked proposed, until they keep or discard it.${dropped}\nrevision r${saved.revision}` }] }
}

/** To 0.01 mm. */
function round(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded // never -0
}
