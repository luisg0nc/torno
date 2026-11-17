import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NOTE_INK, NOTE_PICTURE, NOTE_REFERENCE } from '../../shared/marks'
import { noteFilesExist, readNoteFile, writeNoteFile } from './files'

let dir: string
const folder = (): string => join(dir, '.torno', 'notes')
const bytes = new Uint8Array([1, 2, 3, 4])

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-notes-files-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('writeNoteFile', () => {
  it('names a plain picture, an inked one and a reference as main names them, and writes their bytes', async () => {
    const plain = await writeNoteFile(dir, 'plain', bytes, 'image/png')
    const ink = await writeNoteFile(dir, 'ink', bytes, 'image/png')
    const png = await writeNoteFile(dir, 'reference', bytes, 'image/png')
    const jpg = await writeNoteFile(dir, 'reference', bytes, 'image/jpeg')
    expect(plain).toMatch(NOTE_PICTURE)
    expect(ink).toMatch(NOTE_INK)
    expect(png).toMatch(NOTE_REFERENCE)
    expect(png.endsWith('.png')).toBe(true)
    expect(jpg).toMatch(NOTE_REFERENCE)
    expect(jpg.endsWith('.jpg')).toBe(true)
    for (const name of [plain, ink, png, jpg]) expect([...readFileSync(join(folder(), name))]).toEqual([1, 2, 3, 4])
  })

  it('never gives one name twice', async () => {
    const names = await Promise.all(Array.from({ length: 20 }, () => writeNoteFile(dir, 'plain', bytes, 'image/png')))
    expect(new Set(names).size).toBe(20)
  })

  it('has the folder ignore itself for git, and leaves a .gitignore it finds', async () => {
    await writeNoteFile(dir, 'plain', bytes, 'image/png')
    expect(readFileSync(join(folder(), '.gitignore'), 'utf8')).toBe('*\n')
    writeFileSync(join(folder(), '.gitignore'), '*\n!keep\n')
    await writeNoteFile(dir, 'plain', bytes, 'image/png')
    expect(readFileSync(join(folder(), '.gitignore'), 'utf8')).toBe('*\n!keep\n')
  })

  it('takes a picture of the view as a PNG only, and a reference as a PNG or a JPEG only, and writes nothing else', async () => {
    await expect(writeNoteFile(dir, 'plain', bytes, 'image/jpeg')).rejects.toThrow(/PNG/)
    await expect(writeNoteFile(dir, 'ink', bytes, 'image/gif')).rejects.toThrow(/PNG/)
    await expect(writeNoteFile(dir, 'reference', bytes, 'image/gif')).rejects.toThrow(/PNG or JPEG/)
    expect(existsSync(join(dir, '.torno'))).toBe(false)
  })

  it('writes nothing where .torno/notes is a link, and says why', async () => {
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(writeNoteFile(dir, 'plain', bytes, 'image/png')).rejects.toThrow(/link/)
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([])
  })
})

describe('readNoteFile', () => {
  it('reads what was written', async () => {
    const name = await writeNoteFile(dir, 'ink', bytes, 'image/png')
    expect([...((await readNoteFile(dir, name)) as Buffer)]).toEqual([1, 2, 3, 4])
  })

  it('is null for a file that is not there, a name that is not main’s, and a link in its place', async () => {
    expect(await readNoteFile(dir, 'n-0123456789ab.png')).toBeNull()
    await writeNoteFile(dir, 'plain', bytes, 'image/png')
    writeFileSync(join(folder(), 'notes.txt'), 'x')
    expect(await readNoteFile(dir, 'notes.txt')).toBeNull()
    expect(await readNoteFile(dir, '../marks.json')).toBeNull()
    expect(await readNoteFile(dir, '.gitignore')).toBeNull()
    symlinkSync(join(dir, 'secret'), join(folder(), 'n-aaaaaaaaaaaa.png'))
    writeFileSync(join(dir, 'secret'), 'secret')
    expect(await readNoteFile(dir, 'n-aaaaaaaaaaaa.png')).toBeNull()
  })
})

describe('noteFilesExist', () => {
  const mark = { picture: 'n-0123456789ab.png', ink: 'n-0123456789ab.ink.png', references: [{ file: 'r-0123456789ab.png', comment: '' }, { file: 'r-0123456789ac.jpg', comment: '' }] }

  it('is all false where there is no folder', () => {
    expect(noteFilesExist(dir, mark)).toEqual({ picture: false, ink: false, references: [false, false] })
  })

  it('is all false on an empty folder', () => {
    mkdirSync(folder(), { recursive: true })
    expect(noteFilesExist(dir, mark)).toEqual({ picture: false, ink: false, references: [false, false] })
  })

  it('says which of a note’s files are on this computer', async () => {
    const picture = await writeNoteFile(dir, 'plain', bytes, 'image/png')
    const reference = await writeNoteFile(dir, 'reference', bytes, 'image/jpeg')
    expect(noteFilesExist(dir, { picture, ink: 'n-0123456789ab.ink.png', references: [{ file: reference, comment: '' }, { file: 'r-0123456789ac.jpg', comment: '' }] })).toEqual({ picture: true, ink: false, references: [true, false] })
  })

  it('does not count a folder, or a link, for a file', () => {
    mkdirSync(join(folder(), 'n-0123456789ab.png'), { recursive: true })
    writeFileSync(join(dir, 'secret'), 'x')
    symlinkSync(join(dir, 'secret'), join(folder(), 'n-0123456789ab.ink.png'))
    expect(noteFilesExist(dir, mark)).toMatchObject({ picture: false, ink: false })
  })

  it('is all false where .torno/notes is a link', () => {
    mkdirSync(join(dir, '.torno'))
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(join(dir, 'elsewhere', 'n-0123456789ab.png'), 'x')
    symlinkSync(join(dir, 'elsewhere'), folder())
    expect(noteFilesExist(dir, mark).picture).toBe(false)
  })
})
