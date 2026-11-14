import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import type { Scene } from '../shared/scene'
import { type HistoryEntry, drawable } from '../shared/history'
import type { ObjectInfo } from '../shared/workspace'
import { historySourcePath } from './history'
import type { KernelClient } from './kernel/client'

// An older kept build, drawn again from its copy (Compare can draw any kept build). Its sources are laid out under
// `<userData>/compare/<random>/` at their paths from the workspace (the model in `<project>/`, `common/`, another
// project it imported), so that what the model imports is the copies and not today's files, and the kernel of the
// workspace builds it as a trial: a worker of its own, thrown away, in the environment of that workspace. Nothing is
// written in the workspace, no live build is touched, and the folder is removed when the answer comes; whatever a
// crash left is swept when torno starts (`sweepCompare`).

const FOLDER = 'compare'

/** The folder of the copies laid out, under torno's own data. */
const compareFolder = (userData: string): string => join(userData, FOLDER)

/** Removes what an earlier run left of the copies it laid out. Synchronous: it runs once, before anything is opened. */
export function sweepCompare(userData: string): void {
  rmSync(compareFolder(userData), { recursive: true, force: true })
}

/** The first line of a message, without the traceback some carry. */
const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''

/**
 * Builds the copy of a kept build and gives its scene and mesh as a build does, or says in a sentence why it
 * cannot: the build failed (it has no copies), its copies were not kept, the kernel is busy, or the copy does not
 * build. It builds with the model's own defaults: the build's values of `Params` are not kept with its copies.
 */
export async function rebuildKept(obj: ObjectInfo, entry: HistoryEntry, deps: { kernel: Pick<KernelClient, 'trial'>; userData: string; timeout?: number }): Promise<{ scene: Scene; blob: Uint8Array } | { refused: string }> {
  if (!drawable(entry)) return { refused: `Build ${entry.id} failed, so there is nothing of it to draw.` }
  const project = basename(obj.dir)
  const model = posix.join(project, entry.model)
  if (entry.files.length === 0 || !entry.files.includes(model)) return { refused: `The copies of the files of build ${entry.id} were not kept (too large, or changed while they were read), so it cannot be built again.` }
  if (!deps.kernel.trial) return { refused: 'This kernel cannot build an older copy.' }

  await mkdir(compareFolder(deps.userData), { recursive: true })
  const laid = await mkdtemp(join(compareFolder(deps.userData), 'b-'))
  try {
    for (const file of entry.files) {
      const from = historySourcePath(obj.dir, entry, file)
      const to = join(laid, ...file.split('/'))
      // `historySourcePath` refuses a name that leaves the folder; the way into this one is checked again.
      if (from === null || relative(laid, to).startsWith('..') || relative(laid, to).split(sep).includes('..')) return { refused: `Build ${entry.id} names a file torno will not copy: ${file}.` }
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to).catch(() => {
        throw new Error(`The copy of ${file} in build ${entry.id} is missing.`)
      })
    }
    const result = await deps.kernel.trial(join(laid, project), entry.model, {}, [], { mesh: true, ...(deps.timeout === undefined ? {} : { timeout: deps.timeout }) })
    if (!result.ok) return { refused: `Build ${entry.id} does not build from its copy: ${firstLine(result.error.message) || result.error.kind}` }
    if (!result.blob) return { refused: `The kernel gave no mesh for build ${entry.id}.` }
    return { scene: result.scene, blob: result.blob }
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) }
  } finally {
    await rm(laid, { recursive: true, force: true }).catch(() => {})
  }
}
