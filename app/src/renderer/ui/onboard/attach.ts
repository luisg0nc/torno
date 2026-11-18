import { MOST_REFERENCES } from '../../../shared/objectName'
import { onboard, onboarding } from '../../state/onboard'
import { prepareImage } from './images'
import { reason } from './make'

// What the empty folder's composer adds to the draft through the pickers the page of a new project has: a photo, a bought
// part's STEP file, a scan. Each answers with what is to be said to the person, or null.

const basename = (path: string): string => path.split(/[\\/]/).pop() || path

/** The pictures of the photo dialog, read and scaled for the prompt as the page of a new project does. */
export async function attachPhotos(): Promise<string | null> {
  const paths = await window.torno.objects.pickPhotos().catch(() => [] as string[])
  const epoch = onboarding.epoch()
  const problems: string[] = []
  const ready: Parameters<typeof onboarding.addPhotos>[0] = []
  for (const path of paths) {
    const name = basename(path)
    try {
      const prepared = await prepareImage(await window.torno.objects.readPhoto(path), name)
      const from = prepared.from
      const detail = from.width === prepared.width && from.height === prepared.height ? `${from.width} × ${from.height}` : `${from.width} × ${from.height}, sent at ${prepared.width} × ${prepared.height}`
      ready.push({ path, file: name, image: prepared.image, url: URL.createObjectURL(new Blob([prepared.image as BlobPart], { type: prepared.type })), detail })
    } catch (e) {
      problems.push(reason(e))
    }
  }
  // The draft was thrown away while these were being read: they are not put back into it.
  if (onboarding.epoch() !== epoch) {
    for (const item of ready) URL.revokeObjectURL(item.url)
    return null
  }
  const { left, same } = onboarding.addPhotos(ready)
  if (left > 0) problems.push(`${left} ${left === 1 ? 'photo was' : 'photos were'} left out: at most ${MOST_REFERENCES.photos}.`)
  if (same > 0) problems.push(`${same} ${same === 1 ? 'photo is' : 'photos are'} there already.`)
  return problems.length > 0 ? problems.join(' ') : null
}

export async function attachStep(): Promise<string | null> {
  const path = await window.torno.objects.pickStep().catch(() => null)
  if (path === null) return null
  if (onboarding.addStep({ path, file: basename(path) })) return null
  return onboard.getState().draft.steps.some((s) => s.path === path) ? `${basename(path)} is there already.` : `At most ${MOST_REFERENCES.steps} bought parts.`
}

export async function attachScan(): Promise<string | null> {
  const path = await window.torno.objects.pickScan().catch(() => null)
  if (path === null) return null
  if (onboarding.addScan({ path, file: basename(path) })) return null
  return onboard.getState().draft.scans.some((s) => s.path === path) ? `${basename(path)} is there already.` : `At most ${MOST_REFERENCES.scans} scans.`
}
