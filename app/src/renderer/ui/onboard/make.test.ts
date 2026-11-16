import { describe, expect, it, vi } from 'vitest'
import type { CreateRequest, OnboardDraft, Onboarded } from '../../../shared/bridge'
import type { Draft } from '../../state/onboard'
import { makeObject, pdfReferences, type MakeDeps } from './make'

const draft = (): Draft => ({
  name: 'cable-clip',
  description: '  A clip for a 6 mm cable.  ',
  photos: [
    { uid: 'a', path: '/home/me/IMG_1.JPG', file: 'IMG_1.JPG', note: 'desk edge', image: new Uint8Array([1]), url: 'blob:a' },
    { uid: 'b', path: '/home/me/two.webp', file: 'two.webp', note: '', image: new Uint8Array([2]), url: 'blob:b' }
  ],
  doodles: [{ uid: 'c', strokes: [], png: new Uint8Array([3]), note: 'the shape', url: 'blob:c' }],
  steps: [{ uid: 'f', path: '/p/608zz.STEP', file: '608zz.STEP', note: 'the bearing' }],
  scans: [{ uid: 'd', path: '/s/clip.stl', file: 'clip.stl', note: 'old one' }],
  objects: [{ uid: 'e', id: 'plain', note: 'same style' }]
})

function deps(over: Partial<MakeDeps> = {}) {
  const calls: string[] = []
  const made: MakeDeps = {
    create: vi.fn(async (_req: CreateRequest) => (calls.push('create'), { objectId: 'cable-clip' })),
    onboard: vi.fn(async (_id: string, _d: OnboardDraft): Promise<Onboarded> => (calls.push('onboard'), { sessionId: 's1', prompt: 'the prompt', held: 'the held prompt' })),
    listed: vi.fn(async () => (calls.push('listed'), ['plain', 'cable-clip'])),
    open: vi.fn(async () => void calls.push('open')),
    discard: vi.fn(() => void calls.push('discard')),
    hold: vi.fn(),
    sameWorkspace: vi.fn(() => true),
    folderOf: vi.fn((id: string) => `/ws/${id}`),
    ...over
  }
  return { made, calls }
}

describe('pdfReferences', () => {
  it('names the PDFs as create does: their own names, a name taken in any case numbered', () => {
    expect(pdfReferences([{ path: '/p/Data Sheet.PDF', note: 'a' }, { path: '/q/data sheet.pdf', note: '' }])).toEqual([
      { file: 'reference/Data_Sheet.pdf', note: 'a' },
      { file: 'reference/data_sheet-2.pdf', note: '' }
    ])
  })
})

describe('making the object', () => {
  it('creates, lists, opens, discards the draft, then onboards once, with the pictures named as create names them', async () => {
    const { made, calls } = deps()
    const outcome = await makeObject(draft(), made)
    expect(outcome).toEqual({ kind: 'done', objectId: 'cable-clip' })
    expect(calls).toEqual(['create', 'listed', 'discard', 'open', 'onboard'])
    const req = (made.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRequest
    expect(req).toMatchObject({ name: 'cable-clip', description: 'A clip for a 6 mm cable.', photos: [{ path: '/home/me/IMG_1.JPG', note: 'desk edge' }, { path: '/home/me/two.webp', note: '' }], steps: [{ path: '/p/608zz.STEP', note: 'the bearing' }], scans: [{ path: '/s/clip.stl', note: 'old one' }], objects: [{ id: 'plain', note: 'same style' }] })
    expect(req.doodles).toEqual([{ png: new Uint8Array([3]), note: 'the shape' }])
    expect(made.onboard).toHaveBeenCalledTimes(1)
    expect((made.onboard as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'cable-clip',
      {
        description: 'A clip for a 6 mm cable.',
        items: [
          { file: 'reference/photo-1.jpg', note: 'desk edge', image: new Uint8Array([1]) },
          { file: 'reference/photo-2.webp', note: '', image: new Uint8Array([2]) },
          { file: 'reference/doodle-1.png', note: 'the shape', image: new Uint8Array([3]) }
        ],
        steps: [{ file: 'reference/608zz.step', note: 'the bearing' }],
        scans: [{ path: '/s/clip.stl', note: 'old one' }],
        objects: [{ id: 'plain', note: 'same style' }],
        sizes: [],
        rules: '',
        links: [],
        pdfs: []
      }
    ])
    expect(made.hold).not.toHaveBeenCalled()
  })

  it('sends the index of the photo a doodle is drawn over, and says so in the note the prompt gets, as create does on the card', async () => {
    const d = draft()
    d.doodles = [
      { uid: 'c', strokes: [], png: new Uint8Array([3]), note: 'the shape', url: 'blob:c', over: 'b' },
      { uid: 'g', strokes: [], png: new Uint8Array([4]), note: '', url: 'blob:g', over: 'a' },
      { uid: 'h', strokes: [], png: new Uint8Array([5]), note: 'plain', url: 'blob:h' }
    ]
    const { made } = deps()
    await makeObject(d, made)
    const req = (made.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreateRequest
    expect(req.doodles).toEqual([
      { png: new Uint8Array([3]), note: 'the shape', over: 1 },
      { png: new Uint8Array([4]), note: '', over: 0 },
      { png: new Uint8Array([5]), note: 'plain' }
    ])
    const sent = (made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1] as OnboardDraft
    expect(sent.items.slice(2).map((i) => [i.file, i.note])).toEqual([
      ['reference/doodle-1.png', 'the shape (drawn over reference/photo-2.webp)'],
      ['reference/doodle-2.png', 'drawn over reference/photo-1.jpg'],
      ['reference/doodle-3.png', 'plain']
    ])
  })

  it('hands the model and effort chosen to the onboarding, and nothing of a choice for the person\'s defaults', async () => {
    const { made } = deps()
    await makeObject(draft(), made, { model: 'opus', effort: 'xhigh' })
    expect((made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ choice: { model: 'opus', effort: 'xhigh' } })
    const plain = deps()
    await makeObject(draft(), plain.made, {})
    expect((plain.made.onboard as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty('choice')
  })

  it('stays on the page, with the reason and the draft, when create refuses', async () => {
    const { made, calls } = deps({ create: vi.fn(async () => Promise.reject(new Error("Error invoking remote method 'objects:create': Error: A folder `cable-clip` is there already."))) })
    expect(await makeObject(draft(), made)).toEqual({ kind: 'refused', message: 'A folder `cable-clip` is there already.' })
    expect(calls).toEqual([])
    expect(made.onboard).not.toHaveBeenCalled()
    expect(made.discard).not.toHaveBeenCalled()
  })

  it('does not offer to create again when the object was made and the rescan failed after: it opens the object if it is listed', async () => {
    const { made, calls } = deps({ create: vi.fn(async () => Promise.reject(new Error('cable-clip was made, but the workspace does not list it.'))), listed: vi.fn(async () => ['cable-clip']) })
    const outcome = await makeObject(draft(), made)
    expect(outcome).toEqual({ kind: 'made', objectId: 'cable-clip', message: 'cable-clip was made, but the workspace does not list it. The scans were not imported. The folder is /ws/cable-clip.', opened: true })
    expect(calls).toEqual(['discard', 'open'])
    expect(made.onboard).not.toHaveBeenCalled()
    // The page is gone once the object opens: the reason is said where the session is.
    expect(made.hold).toHaveBeenCalledWith('cable-clip', { text: '', reason: 'cable-clip was made, but the workspace does not list it. The scans were not imported. The folder is /ws/cable-clip.' })
  })

  it('says so, and opens nothing, when the object was made and is not listed', async () => {
    const { made } = deps({ create: vi.fn(async () => Promise.reject(new Error('cable-clip was made, but the workspace was left before it could be opened.'))), listed: vi.fn(async () => ['plain']) })
    expect(await makeObject(draft(), made)).toMatchObject({ kind: 'made', opened: false })
    expect(made.open).not.toHaveBeenCalled()
  })

  it('holds the prompt for the composer, with the reason, when no session was started', async () => {
    const { made } = deps({ onboard: vi.fn(async () => ({ sessionId: null, prompt: 'the prompt', held: 'the held prompt', problem: 'claude is not installed' })) })
    expect(await makeObject(draft(), made)).toEqual({ kind: 'done', objectId: 'cable-clip', problem: 'claude is not installed' })
    expect(made.hold).toHaveBeenCalledWith('cable-clip', { text: 'the held prompt', reason: 'claude is not installed' })
  })

  it('holds it too when a session started and was sent nothing, and when onboard itself rejects (its text is then not known)', async () => {
    const a = deps({ onboard: vi.fn(async () => ({ sessionId: 's1', prompt: 'the prompt', held: 'the held prompt', problem: 'This agent has no chat' })) })
    await makeObject(draft(), a.made)
    expect(a.made.hold).toHaveBeenCalledWith('cable-clip', { text: 'the held prompt', reason: 'This agent has no chat' })
    const b = deps({ onboard: vi.fn(async () => Promise.reject(new Error('cable-clip has a session already.'))) })
    expect(await makeObject(draft(), b.made)).toEqual({ kind: 'done', objectId: 'cable-clip', problem: 'cable-clip has a session already.' })
    expect(b.made.hold).toHaveBeenCalledWith('cable-clip', { text: '', reason: 'cable-clip has a session already.' })
  })

  it('holds a second call while one runs: a click on Create while it works does nothing', async () => {
    let release!: () => void
    const { made } = deps({ create: vi.fn(() => new Promise<{ objectId: string }>((resolve) => (release = () => resolve({ objectId: 'cable-clip' })))) })
    const first = makeObject(draft(), made)
    expect(await makeObject(draft(), made)).toEqual({ kind: 'busy' })
    release()
    await first
    expect(made.create).toHaveBeenCalledTimes(1)
    expect(made.onboard).toHaveBeenCalledTimes(1)
    // And it is free again afterwards.
    expect((await makeObject(draft(), deps().made)).kind).toBe('done')
  })

  it('opens nothing and calls nothing of main when the workspace was left while it worked', async () => {
    const { made } = deps({ sameWorkspace: vi.fn(() => false) })
    expect(await makeObject(draft(), made)).toMatchObject({ kind: 'made', opened: false })
    expect(made.open).not.toHaveBeenCalled()
    expect(made.onboard).not.toHaveBeenCalled()
    const other = deps({ create: vi.fn(async () => Promise.reject(new Error('cable-clip was made, but the workspace does not list it.'))), sameWorkspace: vi.fn(() => false) })
    expect(await makeObject(draft(), other.made)).toMatchObject({ kind: 'made', opened: false })
    expect(other.made.open).not.toHaveBeenCalled()
  })

  it('says the object could not be shown when opening it failed, and still hands the prompt over', async () => {
    const { made } = deps({ open: vi.fn(async () => Promise.reject(new Error('superseded'))) })
    expect(await makeObject(draft(), made)).toEqual({ kind: 'done', objectId: 'cable-clip', shown: false })
    expect(made.onboard).toHaveBeenCalledTimes(1)
  })
})
