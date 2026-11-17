import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jpeg, png } from '../notes/testing'
import { Refusal } from '../refusal'
import { MAX_PHOTO_BYTES, checkedPhoto, readPhoto, savePhoto, sha256Of } from './photos'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-photos-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Bytes of the length, headed as the picture is: a big file that is a picture by its header only. */
const padded = (head: Uint8Array, length: number): Uint8Array => {
  const bytes = new Uint8Array(length)
  bytes.set(head)
  return bytes
}

describe('checkedPhoto', () => {
  it('takes a JPEG of 4000 px and a PNG of 4000 px, and reads their size from the header', () => {
    expect(checkedPhoto(jpeg(4000, 3000))).toMatchObject({ mediaType: 'image/jpeg', width: 4000, height: 3000 })
    expect(checkedPhoto(png(3000, 4000))).toMatchObject({ mediaType: 'image/png', width: 3000, height: 4000 })
  })

  it('refuses a picture whose long edge is 4001 px, of either kind', () => {
    expect(checkedPhoto(png(4001, 100))).toBeNull()
    expect(checkedPhoto(png(100, 4001))).toBeNull()
    expect(checkedPhoto(jpeg(4001, 100))).toBeNull()
  })

  it('refuses a WebP, bytes that are no picture and a picture of no size', () => {
    const webp = new Uint8Array(40)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    expect(checkedPhoto(webp)).toBeNull()
    expect(checkedPhoto(new Uint8Array(40))).toBeNull()
    expect(checkedPhoto(png(0, 10))).toBeNull()
    expect(checkedPhoto('png')).toBeNull()
    expect(checkedPhoto(null)).toBeNull()
  })

  it('takes a file of 25 MB and refuses one of 26 MB', () => {
    expect(checkedPhoto(padded(jpeg(4000, 3000), MAX_PHOTO_BYTES))).not.toBeNull()
    expect(checkedPhoto(padded(jpeg(4000, 3000), 26_000_000))).toBeNull()
    expect(checkedPhoto(padded(png(4000, 3000), 26_000_000))).toBeNull()
  })
})

describe('savePhoto', () => {
  it('keeps the bytes under a name of main, with the size and the hash, and makes the folder ignore itself', async () => {
    const bytes = png(800, 600)
    const kept = await savePhoto(dir, bytes)
    expect(kept.file).toMatch(/^p-[0-9a-f]{12}\.png$/)
    expect(kept).toMatchObject({ width: 800, height: 600, sha256: sha256Of(bytes) })
    const folder = join(dir, '.torno', 'tracings', 'photos')
    expect(readdirSync(folder).sort()).toEqual(['.gitignore', kept.file])
    expect(readFileSync(join(folder, '.gitignore'), 'utf8')).toBe('*\n')
    expect(new Uint8Array(readFileSync(join(folder, kept.file)))).toEqual(bytes)
  })

  it('names a JPEG .jpg and a straightened copy s-, and never the same name twice', async () => {
    const a = await savePhoto(dir, jpeg(100, 100))
    const b = await savePhoto(dir, jpeg(100, 100), 's')
    expect(a.file).toMatch(/^p-[0-9a-f]{12}\.jpg$/)
    expect(b.file).toMatch(/^s-[0-9a-f]{12}\.jpg$/)
  })

  it('does not rewrite a .gitignore the person has changed', async () => {
    mkdirSync(join(dir, '.torno', 'tracings', 'photos'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'tracings', 'photos', '.gitignore'), '*\n!keep.png\n')
    await savePhoto(dir, png(10, 10))
    expect(readFileSync(join(dir, '.torno', 'tracings', 'photos', '.gitignore'), 'utf8')).toBe('*\n!keep.png\n')
  })

  it('refuses what is not a photo, in words, and writes nothing', async () => {
    await expect(savePhoto(dir, png(4001, 10))).rejects.toBeInstanceOf(Refusal)
    await expect(savePhoto(dir, 'nope')).rejects.toThrow(/PNG or JPEG of at most 25 MB and 4000 px/)
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('writes nothing where a link stands in the place of the folder', async () => {
    mkdirSync(join(dir, '.torno', 'tracings'), { recursive: true })
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), join(dir, '.torno', 'tracings', 'photos'))
    await expect(savePhoto(dir, png(10, 10))).rejects.toThrow(/link/)
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([])
  })
})

describe('readPhoto', () => {
  it('reads what was kept, and null for a name that is not main\'s, a file that is not there or a link', async () => {
    const bytes = jpeg(640, 480)
    const { file } = await savePhoto(dir, bytes)
    expect(await readPhoto(dir, file)).toEqual(bytes)
    expect(await readPhoto(dir, 'p-aaaaaaaaaaaa.jpg')).toBeNull()
    expect(await readPhoto(dir, '../tracings.json')).toBeNull()
    expect(await readPhoto(dir, '.gitignore')).toBeNull()
    writeFileSync(join(dir, 'else.jpg'), 'x')
    symlinkSync(join(dir, 'else.jpg'), join(dir, '.torno', 'tracings', 'photos', 'p-bbbbbbbbbbbb.jpg'))
    expect(await readPhoto(dir, 'p-bbbbbbbbbbbb.jpg')).toBeNull()
  })
})
