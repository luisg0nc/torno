import { MAX_OBJECT_NAME, objectNameProblem } from '../../../shared/objectName'

// The empty folder's composer offers a folder name from the words the person typed: the first noun is what the part
// is, the next one what it is for ("a clip that holds a 6 mm cable" is `cable-clip`). There is no grammar here, only
// the words English fills a sentence with, left out; the person can change the name before Start.

const FILLER = new Set(
  (
    'a an the this that these those which who whom whose it its i me my we our you your they their ' +
    'and or but nor so as if then than too very just only also not no yes please ' +
    'is are was were be been being am do does did done have has had having can could will would shall should may might must ' +
    'for to of on in at by with without from into onto over under up down out off about around through between near ' +
    'make makes made making need needs want wants like likes print prints printed printing build builds ' +
    'hold holds holding fit fits fitting attach attaches attaching keep keeps keeping stop stops carry carries support supports ' +
    'something anything thing things one ones some any each every new simple little small big large tiny long short thin thick ' +
    'mm cm m in inch inches millimetre millimetres millimeter millimeters ' +
    'pla petg abs asp tpu nylon resin'
  ).split(' ')
)

/** The words of a sentence worth naming a folder by, in order: letters only, lower case, none of the filler. */
function nouns(words: string): string[] {
  return (words.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => word.length > 1 && !FILLER.has(word))
}

/** `name` cut at a hyphen to at most `MAX_OBJECT_NAME` characters. */
function fitted(name: string): string {
  if (name.length <= MAX_OBJECT_NAME) return name
  const cut = name.slice(0, MAX_OBJECT_NAME)
  const at = cut.lastIndexOf('-')
  return (at > 0 ? cut.slice(0, at) : cut).replace(/-+$/, '')
}

/**
 * A folder name for what is to be made: the second noun and the first (`cable-clip`), or the first alone, from the
 * words as typed; `project` when they give none. It is a name `objectNameProblem` accepts, and one not in `taken`
 * (every entry of the workspace folder; compared as the rule compares them): a name that is taken gets `-2`, then `-3`.
 */
export function folderFromWords(words: string, taken: readonly string[]): string {
  const [head, modifier] = nouns(words)
  const base = head === undefined ? 'project' : fitted(modifier === undefined ? head : `${modifier}-${head}`)
  // A word the workspace keeps for itself, or a Python module, is made into a name by what the part is: a part, or at last a project.
  const choice = [base, fitted(`${base}-part`), 'project'].find((name) => objectNameProblem(name, []) === null) ?? 'project'
  for (let n = 1; n < 1000; n += 1) {
    const name = n === 1 ? choice : `${choice}-${n}`
    if (objectNameProblem(name, taken) === null) return name
  }
  return choice
}
