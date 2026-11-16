import type { CreateRequest, OnboardDraft, Onboarded, PromptPreviewDraft } from '../../../shared/bridge'
import type { AgentChoice } from '../../../shared/chat'
import type { Draft, Held } from '../../state/onboard'
import { PDF_FORMATS, referenceFiles as namedReferences, stepFiles } from '../../../shared/objectName'
import { extensionOf } from './images'

/** What an IPC call failed with, without Electron's wrapping. */
export const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** What "Create" leans on: main's two calls, the workspace, the window's page and the place a prompt is held. */
export interface MakeDeps {
  create(req: CreateRequest): Promise<{ objectId: string }>
  onboard(objectId: string, draft: OnboardDraft): Promise<Onboarded>
  /** The ids of the workspace's objects, as main lists them now; the window's list is refreshed by this. */
  listed(): Promise<string[]>
  /** Shows the object as a click in the list does. */
  open(objectId: string): Promise<void>
  /** The draft is spent. */
  discard(): void
  hold(objectId: string, held: Held): void
  /** Whether the workspace is still the one the object was made in. */
  sameWorkspace(): boolean
  /** Where the object's folder is. */
  folderOf(objectId: string): string
}

export type Outcome =
  /** Another "Create" is under way: this one did nothing. */
  | { kind: 'busy' }
  /** Nothing was made: the reason, and the page and its draft stay. */
  | { kind: 'refused'; message: string }
  /** The object was made but something after failed (the listing): it is not to be made again. `opened` says whether it could be opened. */
  | { kind: 'made'; objectId: string; message: string; opened: boolean }
  /** Made and open; `problem` is why the first prompt was not sent, and then it is held for the composer. */
  | { kind: 'done'; objectId: string; problem?: string; /** False when the window could not show the object (another was chosen meanwhile). */ shown?: false }

/** What `create` will name the photos and the doodles of the draft: photo-<n> with the extension of the file, doodle-<n>.png. */
export function referenceFiles(draft: Draft): OnboardDraft['items'] {
  return [
    ...draft.photos.map((p, n) => ({ file: `reference/photo-${n + 1}${extensionOf(p.path)}`, note: p.note, image: p.image })),
    ...draft.doodles.map((d, n) => ({ file: `reference/doodle-${n + 1}.png`, note: d.note, image: d.png }))
  ]
}

/** What `create` will name the vendor STEP files of the draft: their own names (`stepFiles`). */
export function stepReferences(draft: Draft): OnboardDraft['steps'] {
  const files = stepFiles(draft.steps.map((s) => s.path))
  return draft.steps.map((s, n) => ({ file: files[n], note: s.note }))
}

/** What `create` will name the PDFs of a request: their own names (`referenceFiles`), with the person's note on each. */
export function pdfReferences(pdfs: CreateRequest['pdfs']): OnboardDraft['pdfs'] {
  const files = namedReferences(pdfs.map((p) => p.path), PDF_FORMATS)
  return pdfs.map((p, n) => ({ file: files[n], note: p.note }))
}

/** The draft as `objects.previewPrompt` takes it: no picture, only whether there is one. */
export function previewDraft(draft: Draft): PromptPreviewDraft {
  return {
    description: draft.description.trim(),
    items: referenceFiles(draft).map((i) => ({ file: i.file, note: i.note, picture: (i.image?.byteLength ?? 0) > 0 })),
    steps: stepReferences(draft),
    scans: draft.scans.map((s) => ({ path: s.path, note: s.note })),
    objects: draft.objects.map((o) => ({ id: o.id, note: o.note })),
    // The draft has no sizes, rules, links or PDFs yet.
    sizes: [],
    rules: '',
    links: [],
    pdfs: []
  }
}

let running = false

/** The message of `objects:create` for an object that is on the disk whatever else went wrong. */
const WAS_MADE = /^\S+ was made, but /

/**
 * "Create": makes the folder, shows the object, then hands the first prompt over, once, with the model and effort
 * chosen for its session (`choice`: empty for the person's defaults). A second call while one
 * runs does nothing. The draft is spent as soon as the folder exists, never before: a refusal leaves the page as it was.
 */
export async function makeObject(draft: Draft, deps: MakeDeps, choice: AgentChoice = {}): Promise<Outcome> {
  if (running) return { kind: 'busy' }
  running = true
  try {
    const description = draft.description.trim()
    const request: CreateRequest = {
      name: draft.name,
      description,
      photos: draft.photos.map((p) => ({ path: p.path, note: p.note })),
      doodles: draft.doodles.map((d) => ({ png: d.png, note: d.note })),
      steps: draft.steps.map((s) => ({ path: s.path, note: s.note })),
      scans: draft.scans.map((s) => ({ path: s.path, note: s.note })),
      objects: draft.objects.map((o) => ({ id: o.id, note: o.note })),
      // The draft has no sizes, rules, links or PDFs yet.
      sizes: [],
      rules: '',
      links: [],
      pdfs: []
    }
    // What `onboard` names is what `create` wrote: photo-<n> with the extension of the file, doodle-<n>.png.
    const items = referenceFiles(draft)
    let objectId: string
    try {
      objectId = (await deps.create(request)).objectId
    } catch (e) {
      const message = reason(e)
      if (!WAS_MADE.test(message)) return { kind: 'refused', message }
      // On the disk, whatever the listing says: not made again. Opened if the workspace lists it now.
      objectId = message.split(' ')[0]
      // The scans are imported by `onboard`, which is not called here: the person is told, with where the folder is.
      const told = `${message}${draft.scans.length > 0 ? ' The scans were not imported.' : ''} The folder is ${deps.folderOf(objectId)}.`
      const ids = await deps.listed().catch(() => [] as string[])
      deps.discard()
      // Of this workspace only: one left meanwhile may have an object of the same name.
      const opened = ids.includes(objectId) && deps.sameWorkspace()
      if (opened) {
        await deps.open(objectId).catch(() => {})
        // The page is gone once the object opens: the reason is said where the session is.
        deps.hold(objectId, { text: '', reason: told })
      }
      return { kind: 'made', objectId, message: told, opened }
    }
    await deps.listed().catch(() => [])
    deps.discard()
    if (!deps.sameWorkspace()) return { kind: 'made', objectId, message: `${objectId} was made, but the workspace was left before it could be opened.`, opened: false }
    let shown = true
    await deps.open(objectId).catch(() => void (shown = false))
    let told: Onboarded
    try {
      told = await deps.onboard(objectId, { description, items, steps: stepReferences(draft), scans: request.scans, objects: request.objects, sizes: request.sizes, rules: request.rules, links: request.links, pdfs: pdfReferences(request.pdfs), ...(choice.model || choice.effort ? { choice } : {}) })
    } catch (e) {
      // Nothing is known of the text: the object is made and open, and the reason is said where the chat would be.
      const message = reason(e)
      deps.hold(objectId, { text: '', reason: message })
      return { kind: 'done', objectId, problem: message, ...(shown ? {} : { shown: false as const }) }
    }
    if (told.sessionId === null || told.problem !== undefined) {
      const why = told.problem ?? 'A chat session could not be started.'
      deps.hold(objectId, { text: told.held, reason: why })
      return { kind: 'done', objectId, problem: why, ...(shown ? {} : { shown: false as const }) }
    }
    return { kind: 'done', objectId, ...(shown ? {} : { shown: false as const }) }
  } finally {
    running = false
  }
}
