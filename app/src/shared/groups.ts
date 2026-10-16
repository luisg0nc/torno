import type { PartGroup, Scene } from './scene'
import type { LayerSettings } from './scenefile'

type Grouped = Pick<Scene, 'parts' | 'groups'>

/** The part names of a layout, in the scene's order. */
function namesIn(scene: Grouped, layout: string): string[] {
  return scene.parts.filter((part) => part.layout === layout).map((part) => part.name)
}

/** The groups of a layout: those with a part in it, each with only those parts, in model order. */
export function groupsIn(scene: Grouped, layout: string): PartGroup[] {
  if (!scene.groups?.length) return []
  const present = new Set(namesIn(scene, layout))
  return scene.groups
    .map((group) => ({ name: group.name, parts: group.parts.filter((name) => present.has(name)) }))
    .filter((group) => group.parts.length > 0)
}

/** The group a part is in (by part name, across layouts), or undefined. */
export function groupOf(scene: Pick<Scene, 'groups'>, name: string): PartGroup | undefined {
  return scene.groups?.find((group) => group.parts.includes(name))
}

/** The group of that name, or undefined. */
export function groupNamed(scene: Pick<Scene, 'groups'>, name: string): PartGroup | undefined {
  return scene.groups?.find((group) => group.name === name)
}

/** The words that list a layout's parts (and its groups, when the scene has any) after an unknown name. */
export function unknownPartText(scene: Grouped, layout: string, unknown: string): string {
  const groups = groupsIn(scene, layout)
  const said = groups.length ? `; groups: ${groups.map((group) => group.name).join(', ')}` : ''
  return `unknown part '${unknown}'; parts in layout ${layout}: ${namesIn(scene, layout).join(', ')}${said}`
}

/**
 * Part or group names, as a tool or the window gives them, to the part names of the layout they stand for:
 * each group by its parts there, in order, without repeats. A name that is neither is the failure.
 */
export function partsNamed(
  scene: Grouped,
  layout: string,
  names: readonly string[],
): string[] | { unknown: string; text: string } {
  const present = new Set(namesIn(scene, layout))
  const groups = new Map(groupsIn(scene, layout).map((group) => [group.name, group.parts]))
  const out = new Set<string>()
  for (const name of names) {
    if (present.has(name)) out.add(name)
    else if (groups.has(name)) for (const part of groups.get(name)!) out.add(part)
    else return { unknown: name, text: unknownPartText(scene, layout, name) }
  }
  return [...out]
}

/** Whether a group's parts are shown: all, some or none. A part with no layer settings is visible. */
export function groupVisibility(names: readonly string[], layers: Record<string, LayerSettings>): 'all' | 'some' | 'none' {
  const shown = names.filter((name) => layers[name]?.visible !== false).length
  return shown === names.length ? 'all' : shown === 0 ? 'none' : 'some'
}
