import { SHADOWING_LIBRARIES, STDLIB_MODULES } from './pythonModules'

// The name of a new object is the name of its folder, and its model file is the same name as a Python module.
// What the workspace and the kernel already require of an object folder holds here, and a little more, since
// torno makes the folder: one function, so that the window says what main will refuse.

/** The longest name of an object, in characters. */
export const MAX_OBJECT_NAME = 64

/** The biggest photo a new object takes, in bytes: main copies no more, and the window reads no more. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024

/** The most of each kind of reference a new object is made with: the window holds the draft to it, main holds the request to it. */
/** The most pictures the first prompt of a new object carries (`main/onboard.ts`). */
export const MOST_IMAGES = 6
export const MOST_REFERENCES = { photos: 12, doodles: 6, steps: 4, scans: 4, objects: 8, pdfs: 6 }

/** What a vendor's STEP file of a bought part may be called: the endings a new object takes, and the most of it (50 MB) it copies. */
export const STEP_FORMATS = ['.step', '.stp'] as const
export const MAX_STEP_BYTES = 50 * 1024 * 1024
/** A PDF (a datasheet, a drawing) a new project takes into `reference/`: the ending, and the most of it (25 MB) it copies. */
export const PDF_FORMATS = ['.pdf'] as const
export const MAX_PDF_BYTES = 25 * 1024 * 1024

/**
 * The files `reference/` is given for the files of a draft that keep their own names (vendor STEP files, PDFs), in the
 * order given: the file's own name (the model reads it by that name), with what a folder name may hold of it and the
 * ending in lower case, which is the first of `endings` for a name with none; a name already taken, in any case, is
 * numbered (`-2`). One function, so that the window names the file as main writes it.
 */
export function referenceFiles(paths: readonly string[], endings: readonly string[]): string[] {
  const taken = new Set<string>()
  return paths.map((path) => {
    const base = path.split(/[\\/]/).pop() ?? ''
    const dot = base.lastIndexOf('.')
    const ending = dot > 0 ? base.slice(dot).toLowerCase() : endings[0]
    const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+/, '').slice(0, 64) || 'part'
    for (let n = 1; ; n += 1) {
      const file = `reference/${n === 1 ? stem : `${stem}-${n}`}${ending}`
      if (!taken.has(file.toLowerCase())) {
        taken.add(file.toLowerCase())
        return file
      }
    }
  })
}

/** `referenceFiles` for the vendor STEP files of a draft. */
export function stepFiles(paths: readonly string[]): string[] {
  return referenceFiles(paths, STEP_FORMATS)
}

/** Folders a workspace keeps for itself (the first three are never objects; the rest torno gives a meaning). */
const RESERVED = ['common', 'tests', 'out', 'docs', 'tools', 'reference']

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield'
])

/** `cable-clip` -> `cable_clip`: the model file's name without `.py`, a name Python can import. */
export function moduleName(name: string): string {
  return name.replaceAll('-', '_').replaceAll('.', '_')
}

/**
 * Why `name` cannot be a new object's folder, in a sentence for the person; null when it can. `existing` is
 * every name in the workspace's folder (folders and files), compared without regard to case: a disk may not
 * tell `Clip` from `clip`, and the kernel takes `a-b` and `a_b` for the same model.
 */
export function objectNameProblem(name: string, existing: readonly string[]): string | null {
  if (name === '') return 'Give the project a name.'
  if (name.length > MAX_OBJECT_NAME) return `A name is at most ${MAX_OBJECT_NAME} characters.`
  if (!/^[A-Za-z0-9]/.test(name)) return 'A name starts with a letter or a digit.'
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'A name has only letters, digits, `-` and `_`; a dot would make the model file a different name.'
  if (RESERVED.includes(name.toLowerCase())) return `\`${name}\` is a name the workspace keeps for itself.`
  const module = moduleName(name)
  if (KEYWORDS.has(module)) return `\`${name}\` is a Python keyword, and the model is a Python module.`
  // The object's folder leads `sys.path`: its model would stand in for the library of that name.
  const lowerModule = module.toLowerCase()
  if (SHADOWING_LIBRARIES.some((lib) => lib.toLowerCase() === lowerModule)) return `\`${name}\` is the name of a library the model imports; the model would stand in its place.`
  if (STDLIB_MODULES.some((lib) => lib.toLowerCase() === lowerModule)) return `\`${name}\` is a module of Python's standard library; the model would stand in its place.`
  // The loader and the workspace take these for tests, not models (`_is_test_file`).
  if (module.startsWith('test_') || module.endsWith('_test') || module === 'conftest') return 'A name that starts with `test_` or ends with `_test` makes a test file, not a model.'
  const lower = name.toLowerCase()
  for (const other of existing) {
    if (other.toLowerCase() === lower) return `A folder \`${other}\` is there already.`
  }
  for (const other of existing) {
    if (moduleName(other).toLowerCase() === module.toLowerCase()) return `A folder \`${other}\` is there already, and names the same model.`
  }
  return null
}
