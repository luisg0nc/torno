import { beforeEach, describe, expect, it } from 'vitest'
import { MOST_REFERENCES } from '../../shared/objectName'
import { actions } from './store'
import { draftHas, draftSummary, onboard, onboarding, type DoodleDraft, type Draft, type PhotoDraft } from './onboard'

const photo = (n: number): Omit<PhotoDraft, 'uid' | 'note'> => ({ path: `/p/photo-${n}.jpg`, file: `photo-${n}.jpg`, image: new Uint8Array([n]), url: `blob:p${n}` })
const doodle = (n: number): Omit<DoodleDraft, 'uid' | 'note'> => ({ strokes: [{ tool: 'pen', width: 4, points: [[n, n]] }], png: new Uint8Array([n]), url: `blob:d${n}` })
const info = (root: string) => ({ root, objects: [], hasProject: true }) as never

beforeEach(() => {
  actions.setWorkspace(info('/ws/a'))
  onboarding.discard()
})

describe('the draft of a new object', () => {
  it('starts empty, and says it holds something once a name, a few words or any reference is in it', () => {
    expect(draftHas(onboard.getState().draft)).toBe(false)
    onboarding.setName('  ')
    onboarding.setDescription('\n')
    expect(draftHas(onboard.getState().draft)).toBe(false)
    onboarding.setName('clip')
    expect(draftHas(onboard.getState().draft)).toBe(true)
    onboarding.discard()
    onboarding.addScan({ path: '/s/a.stl', file: 'a.stl' })
    expect(draftHas(onboard.getState().draft)).toBe(true)
  })

  it('keeps at most as many of each kind as main makes an object with, and says how many were left out', () => {
    const photos = Array.from({ length: MOST_REFERENCES.photos + 3 }, (_, n) => photo(n))
    expect(onboarding.addPhotos(photos)).toEqual({ added: MOST_REFERENCES.photos, left: 3, same: 0 })
    expect(onboard.getState().draft.photos).toHaveLength(MOST_REFERENCES.photos)
    expect(onboarding.addPhotos([photo(99)])).toEqual({ added: 0, left: 1, same: 0 })

    for (let n = 0; n < MOST_REFERENCES.doodles; n += 1) expect(onboarding.addDoodle(doodle(n))).toBe(true)
    expect(onboarding.addDoodle(doodle(9))).toBe(false)

    for (let n = 0; n < MOST_REFERENCES.scans; n += 1) expect(onboarding.addScan({ path: `/s/${n}.stl`, file: `${n}.stl` })).toBe(true)
    expect(onboarding.addScan({ path: '/s/more.stl', file: 'more.stl' })).toBe(false)

    for (let n = 0; n < MOST_REFERENCES.objects; n += 1) expect(onboarding.addObject(`o${n}`)).toBe(true)
    expect(onboarding.addObject('more')).toBe(false)
  })

  it('takes a photo, a scan or an object once', () => {
    expect(onboarding.addPhotos([photo(1), photo(1)])).toEqual({ added: 1, left: 0, same: 1 })
    expect(onboarding.addScan({ path: '/s/a.stl', file: 'a.stl' })).toBe(true)
    expect(onboarding.addScan({ path: '/s/a.stl', file: 'a.stl' })).toBe(false)
    expect(onboarding.addObject('bracket')).toBe(true)
    expect(onboarding.addObject('bracket')).toBe(false)
    expect(onboard.getState().draft.scans).toHaveLength(1)
    expect(onboard.getState().draft.objects).toHaveLength(1)
  })

  it('changes a note, removes an item, and changes a doodle in place: the same key, the strokes kept as vectors', () => {
    onboarding.addPhotos([photo(1), photo(2)])
    const [first, second] = onboard.getState().draft.photos
    onboarding.setNote('photos', second.uid, 'the desk edge')
    expect(onboard.getState().draft.photos.map((p) => p.note)).toEqual(['', 'the desk edge'])
    onboarding.remove('photos', first.uid)
    expect(onboard.getState().draft.photos.map((p) => p.uid)).toEqual([second.uid])

    onboarding.addDoodle(doodle(1))
    const [d] = onboard.getState().draft.doodles
    onboarding.setNote('doodles', d.uid, 'the shape')
    onboarding.replaceDoodle(d.uid, doodle(2))
    const [again] = onboard.getState().draft.doodles
    expect(again).toMatchObject({ uid: d.uid, note: 'the shape', strokes: [{ tool: 'pen', width: 4, points: [[2, 2]] }] })
  })

  it('is let go by discard: nothing stays, and the page is not on', () => {
    onboarding.setName('clip')
    onboarding.addPhotos([photo(1)])
    onboarding.discard()
    expect(draftHas(onboard.getState().draft)).toBe(false)
    expect(onboard.getState().draft.photos).toEqual([])
  })

  it('is dropped with the workspace: it was written for a folder that is closed', () => {
    onboarding.setName('clip')
    actions.setWorkspace(info('/ws/b'))
    expect(draftHas(onboard.getState().draft)).toBe(false)
    // A workspace that is refreshed is the same one: the draft stays.
    onboarding.setName('clip')
    actions.refreshWorkspace(info('/ws/b'))
    expect(onboard.getState().draft.name).toBe('clip')
  })

  it('holds the prompt that was not sent for the object, once', () => {
    onboarding.hold('clip', { text: 'First prompt', reason: 'claude is not installed' })
    expect(onboarding.held('clip')).toEqual({ text: 'First prompt', reason: 'claude is not installed' })
    expect(onboarding.take('clip')).toBe('First prompt')
    // The reason stays to be read; the text is held no longer.
    expect(onboarding.take('clip')).toBe('')
    expect(onboarding.held('clip')).toEqual({ text: '', reason: 'claude is not installed', taken: true })
    onboarding.dismiss('clip')
    expect(onboarding.held('clip')).toBeUndefined()
  })

  it('counts a held prompt not yet taken by a chat as one that would be lost, and a taken one no more', () => {
    expect(onboarding.heldUnsent()).toBe(0)
    onboarding.hold('clip', { text: 'First prompt', reason: 'x' })
    onboarding.hold('lid', { text: '', reason: 'y' })
    expect(onboarding.heldUnsent()).toBe(1)
    onboarding.take('clip')
    expect(onboarding.heldUnsent()).toBe(0)
  })

  it('knows when the draft was thrown away since a photo began to be read', () => {
    const began = onboarding.epoch()
    expect(onboarding.epoch()).toBe(began)
    onboarding.discard()
    expect(onboarding.epoch()).not.toBe(began)
  })
})

describe('draftSummary', () => {
  it('words what a draft gives, leaving out the kinds it has none of', () => {
    const d = { name: 'cable-clip', description: 'A clip', photos: [{}, {}, {}], doodles: [{}], scans: [{}], objects: [] } as unknown as Draft
    expect(draftSummary(d)).toEqual({ name: 'cable-clip', described: true, given: [[3, 'photos'], [1, 'doodle'], [1, 'scan']] })
    expect(draftSummary({ ...d, name: ' ', description: '', photos: [], doodles: [], scans: [] })).toEqual({ name: null, described: false, given: [] })
  })
})
