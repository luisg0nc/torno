import { recordDropped } from '../dropped'
import { isNoteFile } from './files'

/** The folder of a project's note pictures, under `.torno`. */
export const NOTES_FOLDER = ['notes'] as const

/** Lists files of `.torno/notes/` torno dropped (`recordDropped`): the sweep of a later run may take them. Never rejects. */
export const dropNoteFiles = (dir: string, names: Iterable<string>): Promise<void> => recordDropped(dir, NOTES_FOLDER, names, isNoteFile)
