import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { OnboardDraft, Onboarded, PromptPreview, PromptPreviewDraft } from '../shared/bridge'
import { type AgentChoice, agentChoiceOf } from '../shared/chat'
import { number } from '../shared/format'
import { MOST_IMAGES, moduleName } from '../shared/objectName'
import type { Scene } from '../shared/scene'
import { SCAN_FORMATS } from '../shared/scans'
import { MAX_SIZES, type SizeFact, checkSize, saySize } from '../shared/size'
import type { ObjectInfo } from '../shared/workspace'
import { FOLDER } from './own'
import { MAX_LINKS, MAX_RULES, MOST, checkLink, oneLine } from './objects/create'
import { THUMB_MAX_BYTES, THUMB_PNG } from './show/cards'
import type { Sessions } from './sessions/manager'
import type { PromptBlock } from './sessions/transport'
import { type ImageBytes, checkedImage } from './images'
// The rule of a picture main attaches (`images.ts`), named here too, where it was first.
export { type ImageBytes, MAX_EDGE, MAX_IMAGE_BYTES, checkedImage } from './images'

// The first prompt of a new object and the call that sends it. The window made the object (`objects:create`) and
// opened it; this imports its scans, starts its chat session, and tells the agent, in one prompt, all that the
// person gave. What the window sends is checked again here, and a picture that is not what it says is left out.

/** The most pictures one prompt carries: photos and doodles first, then the pictures of the objects referred to. */
export { MOST_IMAGES }
const MOST_PARTS_NAMED = 8
const MAX_DESCRIPTION = 20_000
const REFERENCE_FILE = /^reference\/(photo|doodle)-[1-9][0-9]*\.(png|jpg|jpeg|webp)$/
/** A vendor STEP file as `create` names it (`stepFiles`). */
const STEP_FILE = /^reference\/[A-Za-z0-9][A-Za-z0-9._-]*\.(step|stp)$/
/** A PDF as `create` names it (`referenceFiles`). */
const PDF_FILE = /^reference\/[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/

/** The picture an object has on file for its card, or none: a plain file under a plain `.torno`, a PNG within the card's size. */
export async function readThumb(dir: string): Promise<ImageBytes | undefined> {
  try {
    const folder = await lstat(join(dir, FOLDER))
    if (!folder.isDirectory()) return undefined
    const path = join(dir, FOLDER, THUMB_PNG)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > THUMB_MAX_BYTES) return undefined
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const bytes = Buffer.alloc(THUMB_MAX_BYTES + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      return checkedImage(new Uint8Array(bytes.subarray(0, bytesRead))) ?? undefined
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

/**
 * What an object is, as far as its last build in this run says: its parts and the box of the first layout, with
 * whether the kernel says the box is exact. The numbers are the kernel's, written as every number told is.
 */
export function objectSummary(scene: Pick<Scene, 'layouts' | 'parts'> | undefined): string {
  if (!scene) return 'not built in this run'
  const layout = scene.layouts[0]
  const parts = scene.parts.filter((p) => layout === undefined || p.layout === layout)
  if (parts.length === 0) return 'built, with no parts'
  const names = parts.slice(0, MOST_PARTS_NAMED).map((p) => p.name).join(', ')
  const more = parts.length > MOST_PARTS_NAMED ? ` and ${parts.length - MOST_PARTS_NAMED} more` : ''
  const size = [0, 1, 2].map((axis) => Math.max(...parts.map((p) => p.bbox.max[axis])) - Math.min(...parts.map((p) => p.bbox.min[axis])))
  const exact = parts.every((p) => p.bboxExact === true)
  return `${parts.length} ${parts.length === 1 ? 'part' : 'parts'}: ${names}${more}; box ${size.map(number).join(' x ')} mm, ${exact ? 'exact' : 'approximate'}`
}

export interface PromptInput {
  name: string
  description: string
  /** Photos, then doodles. `image` is none for a picture that cannot be attached. */
  items: Array<{ file: string; note: string; image?: ImageBytes; /** A doodle drawn over a photo: the flag the draft keeps, not read from the note. */ over?: true }>
  /** The vendor STEP files copied into `reference/`. */
  steps?: Array<{ file: string; note: string }>
  /** `id` is none for a scan that could not be imported, and `problem` says why. */
  scans: Array<{ id: string | null; file: string; note: string; problem?: string }>
  objects: Array<{ name: string; summary: string; note: string; thumb?: ImageBytes }>
  /** What the person measured or read, told in words (`saySize`). */
  sizes?: SizeFact[]
  /** The rules for the model, as the person wrote them. */
  rules?: string
  /** Links, told one to a line; torno opens none. */
  links?: Array<{ url: string; note: string }>
  /** The PDFs copied into `reference/`. */
  pdfs?: Array<{ file: string; note: string }>
}

const imageBlock = (image: ImageBytes): PromptBlock => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: Buffer.from(image.bytes).toString('base64') } })

/** A doodle the person drew over a photo (one they gave, or one they took away after): the draft says so (`over`), whatever its note says. */
const overPhoto = (item: { over?: true }): boolean => item.over === true

const CLAUDE_TOOL = (tool: string): string => `mcp__torno__${tool}`

/**
 * What would make the first build wrong, named in the prompt and in the `torno-model` skill's "Before the first model"
 * in these words (`prompt.test.ts`): not only sizes (#324).
 */
export const SETTLE = ['how the thing is arranged or mounted', 'which bought part it holds', 'how a drawing reads', 'any size that decides fit or function and has no source'] as const

/**
 * The end of the first prompt (#111, #324): the placeholder, that what was given is kept, and what to settle before
 * building. Given torno's skills (`skills`) it names the skill, where the rule is; without them it says the rule.
 */
function settleText(module: string, toolName: (tool: string) => string, skills: boolean): string[] {
  const settle = `settle what would make the first build wrong${skills ? ', as the torno-model skill says under "Before the first model"' : ''}: ${SETTLE.slice(0, -1).join(', ')}, and ${SETTLE[SETTLE.length - 1]}.`
  const head = [
    `${module}.py is torno's placeholder (a 20 mm cube) for you to replace. What is above is kept for later conversations, in brief.md and on the board (${toolName('board')}): you need not read them now.`,
    ''
  ]
  if (skills) {
    return [
      ...head,
      `Before you build, ${settle} Ask the person in one round, only what would change the build, with a sketch in the option where the question is about shape. A size that does not decide fit is an assumption they can change afterwards in Params, not a question. Then replace the placeholder, and list in your reply what you assumed.`
    ]
  }
  return [
    ...head,
    `Before you build, ${settle} A size has a source when the person gave it (above, or as a size card of the board) or when brief.md, a reference picture's note, a PDF, a scan (≈, to a few mm) or another project says it; a size the person gave is not asked again.`,
    'Ask the person in one round, before you build, with AskUserQuestion, only what would change the build: with a sketch in the option (its preview) where the question is about shape, and for a size one option a typical value labelled as typical ("0.2 mm per side, usual for PLA at a 0.4 mm nozzle"). The person may answer "build with assumptions". What does not decide fit (a fillet, a chamfer, a wall) is an assumption they can change afterwards in Params, not a question. If nothing would change the build, ask nothing.',
    'Then replace the placeholder. What is still unknown is built as assumed (a field of Params whose comment begins "assumed:"), and your reply lists what you assumed.'
  ]
}

/**
 * The first prompt of a new object: the text, then the pictures it says are attached, at most 6 in all, each after a line of text that names it
 * ("Picture 2: reference/doodle-1.png (the person's doodle): <note>"): the CLI gives the model no file name for an image. `held` is
 * the same text for a prompt that is not sent with its pictures (the composer holds it): each picture is named by
 * its file and says it is not attached, and a referred object's picture by the file it is in.
 */
export function onboardPrompt(input: PromptInput, toolName: (tool: string) => string = CLAUDE_TOOL, skills = false): { text: string; held: string; blocks: PromptBlock[]; attached: Array<number | null>; pictured: Array<number | null> } {
  const images: Array<{ image: ImageBytes; caption: (n: number) => string }> = []
  const said = (note: string): string => oneLine(note, 'note')
  /** The number of the picture when it fits in the prompt (it is attached then), else none. */
  const attach = (image: ImageBytes | undefined, what: string, note: string): number | null => {
    if (!image || images.length >= MOST_IMAGES) return null
    const line = said(note)
    images.push({ image, caption: (n) => `Picture ${n}: ${what}${line === '' ? '' : `: ${line}`}` })
    return images.length
  }
  const attached = input.items.map((item) => attach(item.image, `${item.file} (the person's ${item.file.startsWith('reference/doodle') ? 'doodle' : 'photo'})`, item.note))
  const pictured = input.objects.map((other) => (other.thumb ? attach(other.thumb, `../${said(other.name)}/ as torno last drew it (its thumbnail)`, other.note) : null))
  const compose = (held: boolean, long = false): string => {
    const lines: string[] = []
    input.items.forEach((item, i) => {
      const tail = attached[i] !== null && !held ? ` (attached: picture ${attached[i]})` : ` (not attached: read ${item.file})`
      lines.push(`- ${item.file}${said(item.note) === '' ? '' : `: ${said(item.note)}`}${tail}`)
    })
    for (const step of input.steps ?? []) {
      const note = said(step.note)
      const file = said(step.file)
      const name = file.split('/').pop() ?? file
      lines.push(`- ${file}${note === '' ? '' : `: ${note}`}. A vendor's STEP file of a bought part, copied into the project as it is. It is not a part to print: in the model read it with import_step(Path(__file__).parent / "reference" / "${name}") and return it among references(p) (the torno-model skill, "References: bought parts").`)
    }
    for (const pdf of input.pdfs ?? []) {
      const note = said(pdf.note)
      lines.push(`- ${said(pdf.file)}${note === '' ? '' : `: ${note}`}. A PDF; read it with your own tools if it helps.`)
    }
    for (const scan of input.scans) {
      const note = said(scan.note)
      const file = said(scan.file)
      const named = scan.id === null ? `Scan "${file}"` : `Scan ${scan.id} "${file}"`
      const after =
        scan.id === null
          ? `It could not be imported (${said(scan.problem ?? 'for a reason torno did not get')}); the file is the person's to give again.`
          : `It is imported into this project and is not aligned yet: the person aligns it in torno. ${toolName('scans')} says how it stands; once it is aligned, ${toolName('section')} with "scan" cuts it, and ${toolName('scan_clash')} and ${toolName('scan_deviation')} measure against it.`
      lines.push(`- ${named}${note === '' ? '.' : `: ${note}.`} ${after}`)
    }
    input.objects.forEach((other, i) => {
      const name = said(other.name)
      const picture = !other.thumb ? '' : held ? `; its picture: ../${name}/.torno/thumb.png` : pictured[i] !== null ? `; its picture is attached: picture ${pictured[i]}` : '; its picture is not attached'
      const note = said(other.note)
      lines.push(`- ../${name}/ (another project of this workspace: ${other.summary}${picture})${note === '' ? '' : `: ${note}`}`)
    })
    const doodles = input.items.filter((item) => item.file.startsWith('reference/doodle'))
    const given: string[] = []
    if ((input.sizes ?? []).length > 0) given.push('Sizes the person gave:', ...(input.sizes ?? []).map((size) => `- ${saySize(size)}`), '')
    if ((input.rules ?? '').trim() !== '') given.push('Rules:', (input.rules ?? '').trim(), '')
    if ((input.links ?? []).length > 0) {
      given.push('Links (torno does not open links; read one only if it helps):', ...(input.links ?? []).map((link) => `- ${said(link.url)}${said(link.note) === '' ? '' : `: ${said(link.note)}`}`), '')
    }
    return [
      `This is a new project, ${input.name}, made in torno just now. What it is, in the person's words:`,
      '',
      input.description.trim(),
      '',
      ...(lines.length > 0 ? ['What they gave (all of it is also in brief.md; files are in reference/):', ...lines, ''] : []),
      ...given,
      ...(doodles.some((item) => !overPhoto(item)) ? ['A doodle is drawn over a light grid: 1 square = 40 px of the board, with no scale. Read proportions from it, not sizes.', ''] : []),
      ...(doodles.some(overPhoto) ? ["A doodle drawn over a photo is the person's ink over that photo: read it as what they point at in the photo, with no grid.", ''] : []),
      ...settleText(moduleName(input.name), toolName, skills && !long)
    ].join('\n')
  }
  const text = compose(false)
  // Held, it may be sent later in a session without torno's skills: it says the rule itself.
  return { text, held: compose(true, true), blocks: [{ type: 'text', text }, ...images.flatMap((p, i): PromptBlock[] => [{ type: 'text', text: p.caption(i + 1) }, imageBlock(p.image)])], attached, pictured }
}

/** A stand-in for a picture the window holds and says is fit to attach: the preview shows which are attached, and carries none. */
const STAND_IN: ImageBytes = { bytes: new Uint8Array(0), mediaType: 'image/png', width: 1, height: 1 }

/**
 * The first prompt of the draft being made, as `onboardPrompt` writes it for `objects.onboard`, with nothing done:
 * no scan imported (they are numbered S1, S2, ... as the import will), no file read but the thumbnails of the objects
 * referred to, no session. `attached` says which picture of the prompt each item and each object has, or none.
 */
export async function previewPrompt(deps: Pick<OnboardDeps, 'object' | 'scene' | 'skills'>, name: string, draft: PromptPreviewDraft): Promise<PromptPreview> {
  if (typeof name !== 'string' || typeof draft !== 'object' || draft === null) throw new Error('No draft to preview.')
  if (typeof draft.description !== 'string' || draft.description.length > MAX_DESCRIPTION) throw new Error('The description is not text of at most 20,000 characters.')
  for (const kind of ['items', 'steps', 'scans', 'objects', 'sizes', 'links', 'pdfs'] as const) {
    if (!Array.isArray(draft[kind]) || draft[kind].length > MOST_PREVIEW) throw new Error(`The ${kind} are not a short list.`)
  }
  const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 2000) : '')
  const objects: PromptInput['objects'] = []
  for (const other of draft.objects) {
    const found = typeof other?.id === 'string' ? deps.object(other.id) : undefined
    if (!found) continue
    const thumb = await readThumb(found.dir)
    objects.push({ name: found.id, summary: objectSummary(deps.scene(found.id)), note: text(other.note), ...(thumb ? { thumb } : {}) })
  }
  const built = onboardPrompt({
    name: name.trim() === '' ? 'new-project' : name.trim(),
    description: draft.description,
    items: draft.items.map((item) => ({ file: text(item?.file), note: text(item?.note), ...(item?.picture === true ? { image: STAND_IN } : {}), ...(item?.over === true ? { over: true as const } : {}) })),
    steps: draft.steps.map((step) => ({ file: text(step?.file), note: text(step?.note) })),
    scans: draft.scans.map((scan, i) => ({ id: `S${i + 1}`, file: basename(text(scan?.path)), note: text(scan?.note) })),
    objects,
    // What the draft holds that `onboard` would refuse is left out of the preview rather than refused: the page is still being filled.
    sizes: draft.sizes.flatMap((raw) => {
      const size = checkSize(raw, 'person')
      return typeof size === 'string' ? [] : [size]
    }),
    rules: typeof draft.rules === 'string' ? draft.rules.slice(0, MAX_RULES) : '',
    links: draft.links.flatMap((link) => {
      try {
        return [checkLink(link)]
      } catch {
        return []
      }
    }),
    pdfs: draft.pdfs.map((pdf) => ({ file: text(pdf?.file), note: text(pdf?.note) }))
  }, undefined, deps.skills === true)
  return { text: built.text, attached: built.attached, pictured: built.pictured, objects: objects.map((o) => o.name) }
}

const MOST_PREVIEW = 40

export interface OnboardDeps {
  /** An object of the open workspace. */
  object(id: string): ObjectInfo | undefined
  /** Whether the object has a chat or terminal session, or one starting. */
  running(objectId: string): boolean
  /** Imports a file as a scan of the object (`scans:import`); rejects with a reason. */
  importScan(objectId: string, path: string): Promise<{ id: string; name: string }>
  /** Starts the session of the object's agent; rejects with why it cannot. */
  start(obj: ObjectInfo, choice: AgentChoice): Promise<{ sessionId: string; view: string }>
  /** Sends the first prompt, as the onboarding one: its hook's context leaves out what the prompt has just said (the brief, the references). */
  prompt(sessionId: string, blocks: PromptBlock[]): void
  /** Whether a session started now is given torno's skills (`AgentAdapter.skills`): the prompt then names the skill where its rule is. */
  skills?: boolean
  /** Resolves once the session's CLI has taken the prompt up, or with why it ended without; none when this cannot be known. */
  began?(sessionId: string): Promise<{ began: true } | { began: false; why: string }>
  /** Counts everything on the object's board as told (`BoardStore.markAllTold`), just before the first prompt goes. */
  boardTold?(objectId: string): Promise<void>
  /** The last good build of an object in this run. */
  scene(objectId: string): Pick<Scene, 'layouts' | 'parts'> | undefined
}

/** Whether an object has a session, or one is starting there. */
export function sessionRunning(sessions: Pick<Sessions, 'current' | 'isStarting'> | null, objectId: string): boolean {
  return sessions !== null && (sessions.current(objectId) !== null || sessions.isStarting(objectId))
}

/** The objects being onboarded now: one call at a time per object, from the check to the end. */
const onboarding = new Set<string>()

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300)

/** The draft held to what it may be; throws a plain reason. */
async function checked(deps: OnboardDeps, obj: ObjectInfo, draft: OnboardDraft): Promise<{ sizes: SizeFact[]; links: Array<{ url: string; note: string }> }> {
  if (typeof draft !== 'object' || draft === null) throw new Error('No draft to onboard.')
  if (typeof draft.description !== 'string' || draft.description.length > MAX_DESCRIPTION) throw new Error('The description is not text of at most 20,000 characters.')
  const lists = { items: MOST.photos + MOST.doodles, steps: MOST.steps, scans: MOST.scans, objects: MOST.objects, pdfs: MOST.pdfs }
  const named = { items: 'items', steps: 'bought parts', scans: 'scans', objects: 'projects', pdfs: 'PDFs' }
  for (const kind of ['items', 'steps', 'scans', 'objects', 'pdfs'] as const) {
    if (!Array.isArray(draft[kind])) throw new Error(`The ${named[kind]} are not a list.`)
    if (draft[kind].length > lists[kind]) throw new Error(`At most ${lists[kind]} ${named[kind]}.`)
  }
  for (const item of draft.items) {
    if (typeof item?.file !== 'string' || !REFERENCE_FILE.test(item.file)) throw new Error('A photo or a doodle is a file of reference/ that torno made.')
    oneLine(item.note, 'photo or doodle')
    if (typeof item.note !== 'string') throw new Error('The note of a photo or a doodle is not text.')
    const stat = await lstat(join(obj.dir, item.file)).catch(() => null)
    if (!stat?.isFile()) throw new Error(`${item.file} is not there.`)
  }
  for (const step of draft.steps) {
    if (typeof step?.file !== 'string' || !STEP_FILE.test(step.file)) throw new Error('A bought part is a STEP file of reference/ that torno made.')
    if (typeof step.note !== 'string') throw new Error('The note of a bought part is not text.')
    oneLine(step.note, 'bought part')
    const stat = await lstat(join(obj.dir, step.file)).catch(() => null)
    if (!stat?.isFile()) throw new Error(`${step.file} is not there.`)
  }
  for (const pdf of draft.pdfs) {
    if (typeof pdf?.file !== 'string' || !PDF_FILE.test(pdf.file)) throw new Error('A PDF is a .pdf file of reference/ that torno made.')
    if (typeof pdf.note !== 'string') throw new Error('The note of a PDF is not text.')
    oneLine(pdf.note, 'PDF')
    const stat = await lstat(join(obj.dir, pdf.file)).catch(() => null)
    if (!stat?.isFile()) throw new Error(`${pdf.file} is not there.`)
  }
  for (const scan of draft.scans) {
    if (typeof scan?.path !== 'string' || !isAbsolute(scan.path) || !(SCAN_FORMATS as readonly string[]).includes(extname(scan.path).toLowerCase())) throw new Error(`A scan is a ${SCAN_FORMATS.join(', ')} file given by its path.`)
    // One line of the prompt: a control character, a line break above all, could write lines of its own.
    if (/\p{Cc}/u.test(scan.path)) throw new Error('The path of a scan has a control character or a line break in it.')
    if (typeof scan.note !== 'string') throw new Error('The note of a scan is not text.')
    oneLine(scan.note, 'scan')
  }
  for (const other of draft.objects) {
    if (typeof other?.id !== 'string' || deps.object(other.id) === undefined) throw new Error(`There is no project ${JSON.stringify(other?.id)} in this workspace.`)
    if (other.id === obj.id) throw new Error('A project cannot refer to itself.')
    if (typeof other.note !== 'string') throw new Error('The note of a project is not text.')
    oneLine(other.note, 'project')
  }
  if (!Array.isArray(draft.sizes)) throw new Error('The sizes are not a list.')
  if (draft.sizes.length > MAX_SIZES) throw new Error(`At most ${MAX_SIZES} sizes.`)
  const sizes = draft.sizes.map((raw) => {
    const size = checkSize(raw, 'person')
    if (typeof size === 'string') throw new Error(size)
    return size
  })
  if (typeof draft.rules !== 'string') throw new Error('The rules are not text.')
  if (draft.rules.length > MAX_RULES) throw new Error(`The rules are over ${MAX_RULES} characters.`)
  if (!Array.isArray(draft.links)) throw new Error('The links are not a list.')
  if (draft.links.length > MAX_LINKS) throw new Error(`At most ${MAX_LINKS} links.`)
  const links = draft.links.map(checkLink)
  for (const [kind, keys] of [['file', [...draft.items.map((i) => i.file), ...draft.steps.map((x) => x.file), ...draft.pdfs.map((p) => p.file)]], ['scan', draft.scans.map((s) => s.path)], ['project', draft.objects.map((o) => o.id)]] as const) {
    if (new Set(keys).size !== keys.length) throw new Error(`The same ${kind} is given twice.`)
  }
  return { sizes, links }
}

/**
 * Onboards a new object: imports the scans of the draft, starts its session and sends the first prompt. Rejects, doing
 * nothing, for an object that is not of the workspace, one with a session already, and a draft that is not what it
 * may be. A scan that cannot be imported, a picture that cannot be attached and a session that cannot be started do not
 * reject: the text says of the first two, and the answer has the prompt and the reason for the third.
 */
export async function onboardObject(deps: OnboardDeps, objectId: string, draft: OnboardDraft): Promise<Onboarded> {
  const obj = deps.object(objectId)
  if (!obj) throw new Error(`There is no project ${JSON.stringify(objectId)} in the open workspace.`)
  if (onboarding.has(obj.id)) throw new Error(`${obj.id} is being onboarded already.`)
  if (deps.running(obj.id)) throw new Error(`${obj.id} has a session already.`)
  onboarding.add(obj.id)
  try {
    return await onboarded(deps, obj, draft)
  } finally {
    onboarding.delete(obj.id)
  }
}

async function onboarded(deps: OnboardDeps, obj: ObjectInfo, draft: OnboardDraft): Promise<Onboarded> {
  const { sizes, links } = await checked(deps, obj, draft)

  const scans: PromptInput['scans'] = []
  for (const scan of draft.scans) {
    const file = basename(scan.path)
    try {
      const imported = await deps.importScan(obj.id, scan.path)
      scans.push({ id: imported.id, file, note: scan.note })
    } catch (e) {
      scans.push({ id: null, file, note: scan.note, problem: firstLine(e) })
    }
  }
  const objects: PromptInput['objects'] = []
  for (const other of draft.objects) {
    const found = deps.object(other.id)!
    const thumb = await readThumb(found.dir)
    objects.push({ name: found.id, summary: objectSummary(deps.scene(found.id)), note: other.note, ...(thumb ? { thumb } : {}) })
  }
  const { text, held, blocks } = onboardPrompt({
    name: obj.id,
    description: draft.description,
    items: draft.items.map((item) => ({ file: item.file, note: item.note, image: checkedImage(item.image) ?? undefined, ...(item.over === true ? { over: true as const } : {}) })),
    steps: draft.steps.map((step) => ({ file: step.file, note: step.note })),
    scans,
    objects,
    sizes,
    rules: draft.rules,
    links,
    pdfs: draft.pdfs.map((pdf) => ({ file: pdf.file, note: pdf.note }))
  }, undefined, deps.skills === true)

  let started: { sessionId: string; view: string }
  try {
    // The model and effort the person chose on the page, for this session alone; what is not one is their default.
    started = await deps.start(obj, agentChoiceOf(draft.choice))
  } catch (e) {
    return { sessionId: null, prompt: text, held, problem: firstLine(e) }
  }
  if (started.view !== 'chat') return { sessionId: started.sessionId, prompt: text, held, problem: "This agent has no chat to send the first prompt to; it is held, for the person to paste." }
  // The prompt says what is on the board in its own words, so its board line counts all of it as told. Not worth stopping
  // the prompt for: when this fails the line only calls the cards new.
  await deps.boardTold?.(obj.id).catch(() => {})
  try {
    deps.prompt(started.sessionId, blocks)
  } catch (e) {
    return { sessionId: started.sessionId, prompt: text, held, problem: firstLine(e) }
  }
  // A CLI that is signed out, or too old for a flag, starts and leaves: the prompt it never took is held, with the reason.
  const began = await deps.began?.(started.sessionId)
  if (began && !began.began) return { sessionId: started.sessionId, prompt: text, held, problem: began.why }
  return { sessionId: started.sessionId, prompt: text, held }
}
