import { PICTURE_NAME } from '../../shared/board'
import { recordDropped } from '../dropped'

/** The folder of a project's board pictures, under `.torno`. */
export const PICTURES_FOLDER = ['board', 'pictures'] as const

export const isPictureName = (name: string): boolean => PICTURE_NAME.test(name)

/** Lists files of `.torno/board/pictures/` torno dropped (`recordDropped`): the sweep of a later run may take them. Never rejects. */
export const dropPictures = (dir: string, names: Iterable<string>): Promise<void> => recordDropped(dir, PICTURES_FOLDER, names, isPictureName)
