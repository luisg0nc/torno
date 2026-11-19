import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The workspace the README's pictures and its recording are taken in (readme.spec.ts, demo.spec.ts): a copy of some
// projects of a real workspace, in a folder of its own, never the real one (nothing is written where a person works).
//
//   TORNO_README_OBJECTS   the workspace copied from (a folder of projects with its own pyproject.toml and .venv)
//   TORNO_README_PROJECTS  the projects taken, comma-separated, each `<folder>` or `<folder>=<name in the copy>`
//   TORNO_README_SCANS     what becomes of the scans of a copied project, comma-separated `<name>:<id>=<file name>`:
//                          the source is copied beside the project, under `scans/<file name>`, and the scan renamed
//                          to it; `<name>:<id>=` drops the scan. A scan not named keeps its source where it is.
//
// The workspace is made as `<tmp>/workshop/parts`, a plain name, because the page of projects prints its path; a `sign` or `logo` parameter of a
// copied project (the name or wordmark a part is engraved with) is emptied in the copy.
//
// The copy takes each project's files but its `out/`, caches and what torno keeps of a session (`.torno/chat`,
// `.torno/agent`, `session.json`, `prompt.md`, `state.md`), so that nothing of the person's conversations is in it.
// The workspace's `pyproject.toml`, `uv.lock` and `common/` come with it and its `.venv` is linked, so that the
// projects build as they do at home.

const SKIPPED = /__pycache__|\/out(\/|$)|\/cache(\/|$)|\/\.torno\/(chat|agent|session\.json|prompt\.md|state\.md)/

export type ReadmeWorkspace = { root: string; home: string }

/**
 * The folder the workspace is made in, under the system's temporary folder. Its name is plain on purpose: the page of projects
 * prints the workspace's path, and a random `torno-readme-ws-XXXX` there reads as a test. A folder of this name that this code did
 * not make is never touched: the run stops instead.
 */
function top(): string {
  const dir = join(realpathSync(tmpdir()), 'workshop')
  if (existsSync(dir)) {
    if (!existsSync(join(dir, '.torno-readme'))) throw new Error(`${dir} exists and is not the README's workspace: move it away`)
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir)
  writeFileSync(join(dir, '.torno-readme'), '')
  return dir
}

/** What a project of the author's engraves on itself (a `sign: str = "..."` or `logo: str = "..."` parameter) is left out of the copy: no name of a person is on a part in a picture. */
function unsigned(folder: string): void {
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.py'))) {
    const path = join(folder, file)
    const source = readFileSync(path, 'utf8')
    // A logo is emptied only where the model says it may be left empty (`# ... empty for none`): another project is made of its logo.
    const bare = source.replace(/^(\s*sign: str = )"[^"\n]*"/m, '$1""').replace(/^(\s*logo: str = )"[^"\n]*"(\s*#.*empty for none)/m, '$1""$2')
    if (bare !== source) writeFileSync(path, bare)
  }
}

/** The pairs of a `a=b,c` setting: `[a, b]`, `[c, c]`. */
function pairs(setting: string | undefined): [string, string][] {
  return (setting ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes('=') ? ([s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)] as [string, string]) : ([s, s] as [string, string])))
}

/** Whether the environment names a workspace to take the pictures in. */
export const configured = (): boolean => Boolean(process.env.TORNO_README_OBJECTS && process.env.TORNO_README_PROJECTS)

/**
 * The workspace, made anew: its root (the folder torno opens, named `parts`) and a home of its own for torno, so
 * that no file of the person's (their ~/.claude/CLAUDE.md) is listed in the session pane.
 */
export function readmeWorkspace(): ReadmeWorkspace {
  const objects = resolve(process.env.TORNO_README_OBJECTS!)
  const base = top()
  const root = join(base, 'parts')
  const home = join(base, 'home')
  mkdirSync(root)
  mkdirSync(home)
  for (const file of ['pyproject.toml', 'uv.lock']) if (existsSync(join(objects, file))) cpSync(join(objects, file), join(root, file))
  if (existsSync(join(objects, 'common'))) cpSync(join(objects, 'common'), join(root, 'common'), { recursive: true, filter: (s) => !SKIPPED.test(s) })
  if (existsSync(join(objects, '.venv'))) symlinkSync(join(objects, '.venv'), join(root, '.venv'))
  for (const [from, to] of pairs(process.env.TORNO_README_PROJECTS)) {
    cpSync(join(objects, from), join(root, to), { recursive: true, filter: (s) => !SKIPPED.test(s) })
    unsigned(join(root, to))
  }
  const scans = new Map<string, [string, string][]>()
  for (const [key, file] of pairs(process.env.TORNO_README_SCANS)) {
    const [project, id] = key.split(':')
    scans.set(project, [...(scans.get(project) ?? []), [id, file]])
  }
  for (const [project, changes] of scans) {
    const path = join(root, project, '.torno', 'scans.json')
    const file = JSON.parse(readFileSync(path, 'utf8')) as { scans: { id: string; name: string; source: { path: string } }[] }
    for (const [id, name] of changes) {
      const scan = file.scans.find((s) => s.id === id)
      if (!scan) throw new Error(`${project} has no scan ${id}`)
      if (!name) {
        file.scans = file.scans.filter((s) => s !== scan)
        continue
      }
      const folder = join(root, project, 'scans')
      mkdirSync(folder, { recursive: true })
      const copy = join(folder, name)
      // The same bytes and time, so that torno finds the source as it was imported.
      cpSync(scan.source.path, copy, { preserveTimestamps: true })
      scan.name = name
      scan.source.path = copy
    }
    writeFileSync(path, JSON.stringify(file, null, 2))
  }
  return { root, home }
}

/** Sets what `.torno/scene.json` of a project says of its scans, before torno opens it. */
export function showScans(root: string, project: string, scans: Record<string, { visible: boolean; opacity?: number }>): void {
  const path = join(root, project, '.torno', 'scene.json')
  const scene = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {}
  writeFileSync(path, JSON.stringify({ ...scene, scans }, null, 2))
}
