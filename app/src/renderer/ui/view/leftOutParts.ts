import type { Part } from '../../../shared/scene'

/** The most parts tagged in the view as left out: the rest are counted. */
export const MOST_TAGGED = 4

/** A part of the layout is switched off when its layer is not visible. */
export function isSwitchedOff(part: Part, layers: Readonly<Record<string, { visible?: boolean } | undefined>>): boolean {
  return layers[part.name]?.visible === false
}

/**
 * The parts of the layout shown that are switched off, each with where its tag stands (the middle of its box, in the object frame),
 * the first few of them, and how many more there are.
 */
export function leftOutParts(parts: readonly Part[], layers: Readonly<Record<string, { visible?: boolean } | undefined>>): { shown: Array<{ name: string; at: [number, number, number] }>; more: number } {
  const off = parts.filter((part) => isSwitchedOff(part, layers))
  return {
    shown: off.slice(0, MOST_TAGGED).map((part) => ({ name: part.name, at: [(part.bbox.min[0] + part.bbox.max[0]) / 2, (part.bbox.min[1] + part.bbox.max[1]) / 2, (part.bbox.min[2] + part.bbox.max[2]) / 2] })),
    more: Math.max(0, off.length - MOST_TAGGED)
  }
}
