import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PHOTO } from '../objects/create'
import { listReferences, readReference } from './reference'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-reference-'))
  mkdirSync(join(dir, 'reference'))
  mkdirSync(join(dir, '.torno'))
  writeFileSync(join(dir, 'reference', 'photo-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 1]))
  writeFileSync(join(dir, 'reference', 'doodle-2.png'), Buffer.from([0x89, 0x50]))
  writeFileSync(join(dir, 'reference', 'notes.txt'), 'x')
  writeFileSync(join(dir, 'brief.md'), '# x')
  writeFileSync(join(dir, '.torno', 'thumb.png'), 'x')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('a picture of reference/, read again for the window', () => {
  it('is read when it is a plain file of the names torno gives', async () => {
    expect(await readReference(dir, 'reference/photo-1.jpg')).toEqual({ mediaType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) })
    expect((await readReference(dir, 'reference/doodle-2.png'))?.mediaType).toBe('image/png')
  })

  it.each(['reference/../brief.md', 'reference/notes.txt', '.torno/thumb.png', '/etc/passwd', 'reference/photo-9.jpg', 'reference/photo-1.jpg/', 7, undefined])('is nothing for %s', async (file) => {
    expect(await readReference(dir, file as string)).toBeNull()
  })

  it('is nothing through a link, for a file over the cap, or when reference/ is itself a link', async () => {
    symlinkSync(join(dir, 'reference', 'photo-1.jpg'), join(dir, 'reference', 'photo-3.jpg'))
    expect(await readReference(dir, 'reference/photo-3.jpg')).toBeNull()
    writeFileSync(join(dir, 'reference', 'photo-4.png'), Buffer.alloc(MAX_PHOTO + 1))
    expect(await readReference(dir, 'reference/photo-4.png')).toBeNull()
    const other = mkdtempSync(join(tmpdir(), 'torno-reference-other-'))
    try {
      mkdirSync(join(other, 'reference'))
      writeFileSync(join(other, 'reference', 'photo-1.jpg'), 'x')
      symlinkSync(join(other, 'reference'), join(other, 'linked'))
      const obj = join(other, 'obj')
      mkdirSync(obj)
      symlinkSync(join(other, 'reference'), join(obj, 'reference'))
      expect(await readReference(obj, 'reference/photo-1.jpg')).toBeNull()
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe('the references a new conversation is told of', () => {
  it('are the plain files of the names torno gives, photos then doodles, by number', () => {
    writeFileSync(join(dir, 'reference', 'photo-10.png'), 'x')
    writeFileSync(join(dir, 'reference', 'photo-2.webp'), 'x')
    symlinkSync(join(dir, 'reference', 'photo-1.jpg'), join(dir, 'reference', 'photo-3.jpg'))
    expect(listReferences(dir)).toEqual(['photo-1.jpg', 'photo-2.webp', 'photo-10.png', 'doodle-2.png'])
  })
  it('are none without a folder, or through a link', () => {
    expect(listReferences(join(dir, 'nowhere'))).toEqual([])
    const obj = join(dir, 'linked')
    mkdirSync(obj)
    symlinkSync(join(dir, 'reference'), join(obj, 'reference'))
    expect(listReferences(obj)).toEqual([])
  })
})
