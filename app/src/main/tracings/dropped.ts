import { recordDropped } from '../dropped'

/** The folder of a project's tracing photos, under `.torno`. */
export const PHOTOS_FOLDER = ['tracings', 'photos'] as const

/** A photo `p-<12 hex>.jpg|png` or a straightened copy `s-<12 hex>.jpg|png`: the only names main gives a file of the folder. */
export const PHOTO_NAME = /^[ps]-[0-9a-f]{12}\.(?:jpg|png)$/

export const isPhotoName = (name: string): boolean => PHOTO_NAME.test(name)

/** Lists files of `.torno/tracings/photos/` torno dropped (`recordDropped`): the sweep of a later run may take them, 30 days after (`listedFor`): the list holds the day each was listed. Never rejects. */
export const dropPhotos = (dir: string, names: Iterable<string>): Promise<void> => recordDropped(dir, PHOTOS_FOLDER, names, isPhotoName, { dated: true })
