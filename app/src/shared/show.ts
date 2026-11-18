import type { SessionStatus } from './bridge'
import type { GitState } from './git'

/**
 * What the page of objects says of one object of the workspace. Everything here is read: from what main already
 * knows of an object opened in this run, and from the files under its `.torno/` otherwise. Nothing is built,
 * started or loaded to say it.
 */
export interface ObjectCard {
  id: string
  name: string
  /** Why it cannot be built, as the object list says it. */
  problem?: string
  /** The same with the folder's whole path, where `problem` names it by its name alone: for a tooltip. */
  problemAt?: string
  /** Opened in this run: it has a build state, and its marks are checked against it. */
  opened: boolean
  /** Of an object opened in this run: the files its last good build imported from outside its folder (another project's, `common/`), paths from the workspace. Absent for none. */
  uses?: string[]
  build?: { status: 'idle' | 'building' | 'ok' | 'failed'; revision: number; stale: boolean; letGo?: 'memory'; error?: string }
  /**
   * The picture on file: when it was made, of which layout, and whether the model file is newer than it (or
   * another). What it draws otherwise than the object is: `cut` by the section kept with the view, the parts
   * `apart`, and how many parts of the layout it leaves out (`hidden`). `bench` when it is drawn at the bench's
   * scale (`BENCH_MM_PER_PX`, iso, centred on the layout's box) and so can stand at true scale. Null for none.
   */
  thumb: { at: string; layout: string; behind: boolean; cut?: true; apart?: true; hidden?: number; bench?: true } | null
  /**
   * The size of the last build of the layout the picture is of, in mm, as the kernel gave it, and whether that is
   * exact (the B-rep's box; else it is widened to the mesh). Kept in `thumb.json` with the picture, so that a project
   * built in an earlier run has it; absent when the picture has none (made before this was kept) or there is no picture.
   */
  box?: { x: number; y: number; z: number; exact: boolean }
  /** Only while its session waits on an `ask`: the question (the first 140 characters) and when it was put (ms since the epoch). */
  waiting?: { question: string; since: number }
  /** When the newest source of its model was saved (ms since the epoch), read from the files; absent when it has none. */
  sourcesMtimeMs?: number
  /** Null when the marks file could not be read. */
  marks: { open: number; drafts: number } | null
  /** Of the last build of this run; null for an object not built in it (a verdict of no build of this run is none). */
  dimensions: { failing: number; unmeasured: number; passing: number } | null
  /**
   * Only with `dimensions: null`, and only when the object has open dimensions: how many, and how many of them
   * failed when they were last measured, in a run before. No verdict: of no build of this run.
   */
  lastRun?: { dimensions: number; failed: number }
  /** Where its session stands. */
  session: SessionStatus | null
  /** What git says of its sources (`gitState`); absent where there is no git or no repository. */
  git?: GitState
}

/** What a picture is of besides its layout, as the window says it of one it drew. */
export interface ThumbnailOf {
  layout: string
  /** How many parts it draws. */
  parts: number
  cut?: boolean
  apart?: boolean
  /** How many parts of the layout it leaves out. */
  hidden?: number
  /** It is drawn in the bench's mode (`thumbnailPlan`'s `bench`): at `BENCH_MM_PER_PX`, iso, centred on the layout's box. */
  bench?: boolean
}
