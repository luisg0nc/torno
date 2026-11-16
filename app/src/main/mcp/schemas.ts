import { z } from 'zod'
import type { ExplodeState } from '../../shared/explode'
import type { MeasureKind, Quat, ShapeIntent, ShapeKind } from '../../shared/marks'
import { MAX_ASK_OPTIONS, MAX_ASK_REFS } from '../../shared/ask'
import type { AxisPlane, SectionPlane } from '../../shared/view'
import { unknownKeys } from './keys'
import type { EndArg } from './markTools'
import { type ToolResult, failure } from './tools'

// Every input schema and description of the agent's tools, the arguments each takes as a type, and `TOOLS`, which
// `registerTools` (./tools) registers them from. What a schema names is all a tool takes: `refusedKeys`.

export const MIN_SIZE = 256
export const MAX_SIZE = 2000
export const DEFAULT_SIZE = 1280

// The field of view of the viewport's own camera: DEFAULT_FOV in src/renderer/viewport/views.ts.
export const FOV = 35

/** The most part names a tool takes in one call. */
export const MAX_PARTS = 64

export const VIEW_NAMES = ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'] as const
export const vec3 = z.tuple([z.number(), z.number(), z.number()])
/**
 * A plane, in either form the agent may give one in. The schema names the
 * two forms and refuses nothing: whatever is given reaches the tool, which
 * answers what is no plane with what one looks like (`NO_PLANE`), where the
 * schema's own refusal would say only that the input is invalid.
 */
export const planeInput = z.union([z.strictObject({ axis: z.enum(['x', 'y', 'z']), at: z.number() }), z.strictObject({ origin: vec3, normal: vec3 }), z.unknown()])
export const planeHelp = '{"axis": "z", "at": 3} for the plane across x, y or z at that coordinate, its normal along +axis, or {"origin": [x, y, z], "normal": [x, y, z]}, a point of the plane and its normal, in mm in the frame of the layout'
/** Said of a plane that is none. */
export const NO_PLANE = 'that is not a plane: give {"axis": "z", "at": 3} for the plane across x, y or z at that coordinate in mm, or {"origin": [x, y, z], "normal": [x, y, z]} with a normal that is not all zeros'
/**
 * An argument the schema names the shape of and refuses nothing for: whatever is given reaches the tool, which
 * answers what is not one with what one looks like and an example, where the schema's own refusal would say only
 * that the input is invalid.
 */
export const loose = <T extends z.ZodType>(shape: T) => z.union([shape, z.unknown()])
/** How far apart the parts are drawn, as the agent may say it: a number, or the whole of it. Loose: what is neither reaches the tool, which says what one is (`explodeHelp`). */
const explodeInput = loose(z.union([z.number(), z.strictObject({ amount: z.number(), scale: z.number().optional(), axis: z.enum(['centre', 'x', 'y', 'z']).optional() })]))
export const explodeHelp = 'a number from 0 to 1 (how far apart the parts are drawn, away from the centre of the layout), or {"amount": 0.5, "axis": "z", "scale": 2} to set them apart along x, y or z (axis; "centre" is the default) and nearer or further (scale from 0.25 to 4, default 1). For display only: positions, refs and measurements are always of the parts as assembled.'
const scanText = 'The number of a scan (S1), as listed by scans. Default: the only scan of the project.'
// Loose: a key a camera does not take reaches the tool, which refuses it by name (`cameraKeys`).
// A camera is what `scene` and a mark give as one, whole: the agent reads the view, shows something, and puts the view back.
export const cameraInput = z.looseObject({ position: vec3, target: vec3, up: vec3.optional(), ortho: z.boolean().optional(), fov: z.number().optional(), zoom: z.number().optional() })
export const CAMERA_KEYS = ['position', 'target', 'up', 'ortho', 'fov', 'zoom']

// Loose: what is neither a ref nor a box reaches the tool, which says what a focus is (`focusOf`, ./focus).
const focusInput = loose(z.union([z.string(), z.strictObject({ min: vec3, max: vec3 })]))
const focusHelp = 'A place to frame on, for a detail: a ref (lid/F12, lid/E3, lid), a group, the number of a mark (M4), or a box {"min": [x, y, z], "max": [x, y, z]} in mm in the frame of the layout.'
const marginInput = loose(z.number())
const marginHelp = "With focus: how far round it the picture reaches, as a share of the focus box's longest side (counted as 20 mm at the least), 0 to 5. Default 0.3."

const lookInput = {
  view: loose(z.union([z.string(), cameraInput]))
    .optional()
    .describe(
      "'current' (the default) is the user's own camera. iso, front, back, left, right, top and bottom are orthographic views fitted to the parts. Or the name of a saved view, as scene lists them: the picture is then of that view whatever is on screen (its camera, layout, parts, section or explode, scans), and whatever you give beside it wins. Or a camera: {position, target, up?, ortho?, fov?, zoom?} in mm, Z up."
    ),
  layout: z.string().optional().describe('The layout to draw, as listed by scene. Default: the one on screen.'),
  parts: z.array(z.string()).max(MAX_PARTS).optional().describe('Names of parts or groups to draw (a group stands for its parts in the layout, as scene lists them under groups). Default: the parts the user has switched on.'),
  size: z.number().optional().describe(`Long edge of the image in pixels, ${MIN_SIZE} to ${MAX_SIZE}. Default ${DEFAULT_SIZE}.`),
  marks: z.boolean().optional().describe("Draw the user's and your marks with their numbers. Default true."),
  section: z
    .union([z.literal('current'), planeInput])
    .nullable()
    .optional()
    .describe(`The cut the parts are drawn with: 'current' (the default) is the user's own section, if they have one; null draws them whole; or a plane of your own, ${planeHelp}. What lies on the side the normal points to is not drawn: with {axis, at}, what is at a greater x, y or z than at is removed.`),
  scans: loose(z.union([z.boolean(), z.array(z.string())]))
    .optional()
    .describe("Which scans are drawn: true or absent, those on the user's screen; false, none; or their numbers, [\"S1\"]."),
  scanColour: loose(z.looseObject({ part: z.string(), scan: z.string().optional(), range: z.number().optional() }))
    .optional()
    .describe('{"part": "tub"}, with scan and range when needed: colours one scan by its distance to a part, from 0 to range mm (default 20), shaded, seen through beyond the range so that the part stays in sight, with scan points inside the part marked and drawn over it: a picture for the eye, made from the meshes on screen; the numbers are scan_deviation\'s. The caption gives the colours.'),
  frame: loose(z.enum(['parts', 'all']))
    .optional()
    .describe('What a named view (iso, top, …) is fitted to: parts (the default), the parts drawn; all, the scans drawn with them. A scan is the surroundings and the parts lie somewhere inside it: the caption says when a scan drawn reaches beyond the picture.'),
  explode: explodeInput
    .nullable()
    .optional()
    .describe(`How far apart the parts are drawn in the picture: ${explodeHelp} The caption says when a picture is exploded. null or 0 draws them together. Default: as on the user's screen. Not with a section.`),
  focus: focusInput.optional().describe(`${focusHelp} The camera looks at it from the side that view names (front, iso, …, or a camera's direction; default: the way the user's camera looks) and stands where it takes in the box and its margin: a detail with the picture's whole resolution. The caption says what was framed, and when the middle of it is hidden behind other parts. The parts are drawn together. Not with the name of a saved view.`),
  margin: marginInput.optional().describe(marginHelp)
}

export type PlaneArg = SectionPlane | AxisPlane

/** A camera as the agent gives one. */
export interface CameraArg { position: Vec3; target: Vec3; up?: Vec3; ortho?: boolean; fov?: number; zoom?: number }

export interface LookArgs {
  /** `current`, a standard view, the name of a saved view, or a camera. */
  view?: string | CameraArg
  layout?: string
  parts?: string[]
  size?: number
  marks?: boolean
  section?: 'current' | PlaneArg | null
  scans?: boolean | string[]
  scanColour?: { part: string; scan?: string; range?: number }
  frame?: 'parts' | 'all'
  explode?: ExplodeArg | null
  focus?: FocusArg
  margin?: number
}

export interface BoardArgs {
  frame?: string
  pictures?: boolean
}

export interface AddCardArgs {
  text?: string
  look?: LookArgs
  frame?: string
  arrowFrom?: string
  arrowTo?: string
  label?: string
  card?: string
  remove?: boolean
}

/** A focus as the agent gives one: a ref, a group, a mark, or a box. */
export type FocusArg = string | { min: Vec3; max: Vec3 }

/** An explode as the agent gives one: the amount alone, or with an axis and a scale. */
export type ExplodeArg = number | (Pick<ExplodeState, 'amount'> & Partial<ExplodeState>)

type Vec3 = [number, number, number]

const refText = 'A ref names a part (lid), one of its faces (lid/F12) or edges (lid/E3), as given by marks, scene and describe; or a face or edge the model names (lid/@top, from tags() in the model, listed by scene), which holds across builds.'
const layoutText = 'The layout the refs are of, as listed by scene. Default: the one on screen.'

const sceneInput = {
  layout: z.string().optional().describe('List the parts of that layout. Default: the one on screen; the parts of the others are counted, not listed.')
}

const marksInput = {
  status: z
    .enum(['draft', 'sent', 'resolved', 'open'])
    .optional()
    .describe('Only the marks of that status: draft (not yet told to you), sent, resolved, or open for all that are not resolved. Default: open (resolved marks only on request, or by ids).'),
  ids: z.array(z.string()).optional().describe('Only these marks, by number: ["M4"]. Whatever their status; a stroke is then given with all its points.'),
  limit: z.number().int().optional().describe('The most marks to list. Default 50, at most 200.'),
  next: z.string().optional().describe('Where to go on after a list that left marks out: the number the answer gives under next (M51).'),
  layout: z.string().optional().describe(`${layoutText} A region of a scan is told where the scan stands in that layout; every other mark is in its own.`)
}

const describeInput = {
  ref: z.string().describe(`${refText} Or the number of a mark (M3), which returns that mark; or the name of a group of parts, as scene lists them under groups.`),
  layout: z.string().optional().describe(layoutText)
}

const highlightInput = {
  refs: z.array(z.string()).min(1).max(50).describe(`${refText} A mark number (M3) stands for what that mark is on. A group name stands for all of its parts.`),
  note: z.string().optional().describe('A short line shown beside them, such as the question you are asking.'),
  layout: z.string().optional().describe('The layout the refs are of. It must be the one on screen, which is the default.')
}

const askInput = {
  question: z.string().describe('The question, in a line or two.'),
  options: z
    .array(z.object({ label: z.string().describe('What the button says, a few words.'), refs: z.array(z.string()).max(MAX_ASK_REFS).describe(`The refs this answer is about; they light up in the viewport when the person points at the button. ${refText} A mark number (M3) stands for what that mark is on. A group name stands for all of its parts. None is fine for "neither".`) }))
    .max(MAX_ASK_OPTIONS)
    .describe(`The answers to choose from, at most ${MAX_ASK_OPTIONS}. May be empty when pick is true.`),
  pick: z.boolean().optional().describe('True lets the person answer by selecting one face or edge in the viewport instead. Default: false.'),
  layout: z.string().optional().describe('The layout the refs are of. It must be the one on screen, which is the default.')
}

const showInput = {
  view: loose(z.union([z.string(), cameraInput]))
    .optional()
    .describe('iso, front, back, left, right, top or bottom, fitted to the parts shown; or the name of a saved view, as scene lists them, which puts all of it on their screen for now (its camera, layout, parts, section or explode, scans; whatever you give beside it wins); or a camera: {position, target, up?, ortho?, fov?, zoom?} in mm, Z up. Default: the camera stays.'),
  layout: z.string().optional().describe('The layout to switch to, as listed by scene. Default: the one on screen stays.'),
  parts: z.array(z.string()).max(MAX_PARTS).optional().describe('Names of parts or groups to leave switched on (a group stands for its parts in the layout, as scene lists them under groups); every other part of the layout is hidden. Default: no part is switched.'),
  section: planeInput
    .nullable()
    .optional()
    .describe(`A cut to put on the user's screen: ${planeHelp}; what lies on the side the normal points to is not drawn: with {axis, at}, what is at a greater x, y or z than at is removed. null takes their section away. Default: it stays as it is.`),
  scans: loose(z.array(z.string())).optional().describe('The numbers of the scans to leave switched on, ["S1"]; every other scan is hidden, and [] hides them all. For now only: it is not what the user\'s saved view keeps. Default: no scan is switched.'),
  scanOpacity: loose(z.number()).optional().describe('How see-through the scans left on are drawn, 0.05 to 1. For now only. Default: as they are.'),
  explode: explodeInput
    .nullable()
    .optional()
    .describe(`How far apart the parts are drawn on the user's screen, for now only: ${explodeHelp} null or 0 puts them together. Default: as they are. Not with a section: pass section null with it when their view is cut.`),
  focus: focusInput.optional().describe(`${focusHelp} Their camera goes to it from the side that view names (front, iso, …, or a camera's direction; default: the way their camera looks), standing where it takes in the box and its margin. Not with the name of a saved view, and not while their parts are drawn apart (explode null).`),
  margin: marginInput.optional().describe(marginHelp)
}

const saveViewInput = {
  // Not required by the schema: left out, the tool says what a name is.
  name: loose(z.string()).optional().describe('What the view is called, 1 to 40 characters, as the user will read it in their strip of views: "Wall at the latch". Not current, iso, front, back, left, right, top or bottom, and not the name of a view of the user\'s.'),
  note: loose(z.string()).optional().describe('Why you propose it, in a line.'),
  view: loose(z.union([z.string(), cameraInput])).optional().describe('iso, front, back, left, right, top or bottom, fitted to the parts, or a camera as scene gives one. Default: the user\'s own camera.'),
  layout: z.string().optional().describe('The layout the view is of. Default: the one on screen.'),
  parts: z.array(z.string()).max(MAX_PARTS).optional().describe('Names of parts or groups the view shows (a group stands for its parts in the layout, as scene lists them under groups; the view keeps the part names); every other part of the layout is hidden in it. Default: those on screen.'),
  section: planeInput.nullable().optional().describe(`The cut the view has: ${planeHelp}; null for none. Default: the one on screen. Not with explode.`),
  explode: explodeInput.nullable().optional().describe(`How far apart the view draws the parts: ${explodeHelp} Default: as on screen. Not with a section.`)
}

export interface SaveViewArgs {
  name: string
  note?: string
  view?: (typeof VIEW_NAMES)[number] | CameraArg
  layout?: string
  parts?: string[]
  section?: PlaneArg | null
  explode?: ExplodeArg | null
}

export const SHAPES = ['box', 'cylinder', 'sphere', 'plane'] as const
export const INTENTS = ['add', 'remove', 'keep-out', 'reference'] as const
export const MEASURES = ['distance', 'angle', 'radius', 'diameter', 'thickness'] as const satisfies readonly MeasureKind[]

/** An end of a measurement, as the agent names one. Like a plane, whatever is given reaches the tool, which says what an end is (`noEnd`). */
// Strict: an object is given to the tool as it came. Were a key it does not name dropped, a point of a scan would pass for a bare point.
const endInput = z.union([z.string(), z.strictObject({ scan: z.string(), point: vec3 }), z.strictObject({ ref: z.string().optional(), point: vec3.optional() }), z.unknown()])
const endText =
  'A ref of a face or an edge ("lid/F12", "lid/E3"), the number of a mark ("M3": what that mark is on), {"point": [x, y, z]} in mm in the frame of the layout, or {"ref": "lid/F12", "point": [x, y, z]} for the feature the ref names, taken at that point of it.'
const scanEndText =
  'An end of a distance may also be a point of a scan, {"scan": "S1", "point": [x, y, z]} in mm in the frame of the layout, as scan_clash and scan_deviation give them, or the number of a region mark (its centroid): the reply is then approximate.'

const addMarkInput = {
  kind: z
    .enum(['pin', 'pick', 'arrow', 'shape', 'dimension'])
    .describe('pin: a point. pick: a whole part, face or edge. arrow: from a point, a direction and a length. shape: a box, cylinder, sphere or plane in space. dimension: an exact measurement that stays on the part, given by measure, a and, between two ends, b.'),
  note: z.string().describe('What the mark says to the user, in a line.'),
  ref: z.string().optional().describe(`What a pin, a pick or the start of an arrow is on. ${refText} Without a point, the mark is put at the centre of the face or edge. A pin given an edge is a pin on that edge.`),
  point: vec3.optional().describe('Where a pin is, or an arrow starts: [x, y, z] in mm in the frame of the layout. Without a ref, it is tied to the part whose surface it is on, if any.'),
  to: vec3.optional().describe('Where an arrow ends: [x, y, z] in mm.'),
  by: vec3.optional().describe('Instead of to, never with it: the vector from the start of an arrow to its end, in mm.'),
  shape: z.enum(SHAPES).optional().describe('For a shape: which.'),
  size: vec3.optional().describe('For a shape, in mm: a box is [x, y, z]; a cylinder [diameter, diameter, height] along its Z; a sphere [diameter, diameter, diameter]; a plane [width, height, 0].'),
  position: vec3.optional().describe('For a shape: its centre, [x, y, z] in mm.'),
  rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().describe('For a shape: a quaternion [x, y, z, w]. Default: not turned.'),
  intent: z.enum(INTENTS).optional().describe('For a shape: material to add, material to remove, a volume to keep out of, or only a reference.'),
  measure: z.enum(MEASURES).optional().describe('For a dimension: what is measured. distance and angle are between a and b; radius, diameter and thickness are of a alone.'),
  a: endInput.optional().describe(`For a dimension: its first end. ${endText} A wall's thickness is measured at a point of a face: {ref, point}. Never a point of a scan or a region: a dimension is of the model, checked on every build.`),
  b: endInput.optional().describe('For a dimension of a distance or an angle: its other end, given as a is.'),
  expected: z.number().optional().describe('For a dimension: what it should measure, in mm or degrees. The dimension then passes or fails on every build.'),
  tolerance: z.number().optional().describe('For a dimension: how far from expected it may be, zero or more. Default 0.05 mm, 0.1° for an angle.'),
  layout: z.string().optional().describe('The layout the mark is in, whose frame its coordinates are in. Default: the one on screen.')
}

const measureInput = {
  kind: z
    .enum(['distance', 'angle', 'radius', 'diameter', 'thickness', 'bbox', 'volume', 'area', 'mass'])
    .describe(
      'distance (between parallel planes, between axes, from a point to a plane, else the minimum) and angle are between a and b. An angle is between flat faces, straight edges and the axes of cylinders, cones, tori and circles (between axes, axis to plane); a face flat or an edge straight within 1e-6 mm is taken too, as not exact. radius and diameter are of a round face or a circular edge; thickness of a wall, from a point of a face along its inward normal; bbox of a part, a face or an edge; area of a part or a face; volume and mass of a part.'
    ),
  // Not required by the schema: left out, the tool says what an end is.
  a: endInput.optional().describe(`What is measured, or its first end. ${endText} A whole part (lid) where the kind takes one. ${scanEndText}`),
  b: endInput.optional().describe('The other end of a distance or an angle, given as a is.'),
  density: z.number().optional().describe('For mass: g/cm³. Default: the density of the material in the project\'s print profile when it has one, else 1.24, PLA; the reply says so.'),
  layout: z.string().optional().describe(layoutText)
}

const sectionInput = {
  // Not required by the schema: left out, the tool says what a plane is.
  plane: z.union([z.literal('current'), planeInput]).optional().describe(`The plane to cut by: ${planeHelp}; or 'current' for the user's own section.`),
  parts: z.array(z.string()).max(MAX_PARTS).optional().describe('Names of the parts to cut. Default: every part of the layout. With fewer parts each loop has more of the 1,500 points an answer holds.'),
  layout: z.string().optional().describe('The layout to cut, as listed by scene. Default: the one on screen.'),
  size: z.number().optional().describe(`Long edge of the drawing in pixels, ${MIN_SIZE} to ${MAX_SIZE}. Default ${DEFAULT_SIZE}.`),
  deflection: z.unknown().optional().describe('How far the outlines may stray from the true ones, in mm, 0.005 to 0.05. Default 0.01.'),
  scan: loose(z.string()).optional().describe('The number of a scan (S1) to cut by the same plane: where it crosses the plane is added to the drawing as a dashed hairline and to the JSON under scan, to 0.1 mm, in its share of the 1,500 points an answer holds, approximate. Refused where the scan is not aligned.')
}

const scansInput = {
  layout: z.string().optional().describe('The layout whose alignment is told, as listed by scene. Default: the one on screen.')
}

// Of the scan tools nothing is required by the schema, and no number is refused by it: left out or out of range,
// the tool says what it takes, with an example.
const scanClashInput = {
  part: loose(z.string()).optional().describe('The name of a part, as listed by scene: "tub".'),
  scan: loose(z.string()).optional().describe(scanText),
  ignore: loose(z.array(z.string())).optional().describe('Region marks of the scan to leave out, by number: ["M7"].'),
  margin: loose(z.number()).optional().describe('How far round the part scan points are looked at, in mm, 0 to 50. Default 5.'),
  layout: z.string().optional().describe('The layout the part is in and the scan is aligned in, as listed by scene. Default: the one on screen.')
}

const scanDeviationInput = {
  part: loose(z.string()).optional().describe('The name of a part, as listed by scene: "plate".'),
  faces: loose(z.array(z.string())).optional().describe('Refs of faces of that part, ["plate/F5"]: only those are measured. Default: the whole part.'),
  scan: loose(z.string()).optional().describe(scanText),
  region: loose(z.string()).optional().describe('The number of a region mark of the scan ("M7"): only that part of the scan counts.'),
  from: loose(z.enum(['part', 'scan'])).optional().describe('part (the default): points of the part, each to the nearest triangle of the scan. scan: vertices of the scan, each to the part.'),
  within: loose(z.number()).optional().describe('How far from each point the other is looked for, in mm, 0.1 to 200. Default 50. Points with nothing that near are counted, not measured.'),
  samples: loose(z.number()).optional().describe('How many points are measured, 100 to 20,000. Default 10,000.'),
  layout: z.string().optional().describe('The layout the part is in and the scan is aligned in, as listed by scene. Default: the one on screen.')
}

const buildRef = z.union([z.number().int(), z.string()])
const diffInput = {
  from: buildRef.optional().describe('The build to compare from: a revision of this run, as scene and the build status give it (3), or a build kept in the history by its id ("h41", from the history tool). Default: the successful build before the last.'),
  to: buildRef.optional().describe('The build to compare to, named the same way. Default: the last successful build.')
}
const historyInput = {
  id: z.string().optional().describe('A kept build by its id ("h41"): the answer is that build alone, with where its copies of the sources are. Default: the list.'),
  limit: z.number().int().optional().describe('How many builds the list gives, the newest first, 1 to 100. Default 20.')
}
const boardInput = {
  frame: z.string().optional().describe('Only this frame and the cards in it: its name ("Latch") or its id ("C3"). Default: the whole board.'),
  pictures: z.boolean().optional().describe('Also send the pictures of the cards that have one, at most 6, each at most 1280 px on its long edge. Default false: they are named in the text.')
}
const addCardInput = {
  text: z.string().optional().describe('The words of a text card; the caption of a picture when look is given; the new words of the card you change (card).'),
  look: loose(z.looseObject(lookInput)).optional().describe('Make a card of a picture of the view, drawn as the look tool draws it, with the same arguments, at 1280 px. The picture and its camera stay on the card.'),
  frame: z.string().optional().describe('Put the card in this frame, by name or id. A name that no frame has makes a frame of yours with it. A frame of the person\'s with no room left gets the card just below it, outside it, and you are told so.'),
  arrowFrom: z.string().optional().describe('Draw an arrow from this card (an id such as "C3") to the new card.'),
  arrowTo: z.string().optional().describe('Draw an arrow from the new card to this card (an id such as "C3").'),
  label: z.string().optional().describe('A few words on the arrow.'),
  card: z.string().optional().describe('The id of a card of yours to change (give text) or to remove (remove: true). Never a card of the person\'s or of torno\'s own.'),
  remove: z.boolean().optional().describe('Take the card named in card off the board, with the arrows on it.')
}
const expectInput = {
  checks: z.array(z.unknown()).describe('What the next edit should change, 1 to 20 checks, each one of: {"part": "plate", "volume": {"change": -1200, "tolerance": 50}} (a part\'s volume, faces, edges or size, as a value or a change from now; size is [x, y, z]); {"measure": {"kind": "diameter", "a": "plate/F9"}, "expected": 6.4, "tolerance": 0.05} (a measurement as measure takes it); {"unchanged": ["lid", "hinge"]} (those parts keep their volume, box and counts).'),
  note: z.string().optional().describe('A few words on what the edit is for; told back with the verdict.')
}
const checkInput = {
  kind: z.enum(['overlap', 'clearance', 'interference', 'mesh', 'overhang', 'thin', 'bed']).describe('overlap and clearance are of the two parts a and b; mesh, overhang and thin are of the part a; interference and bed are of the whole layout.'),
  a: z.string().optional().describe('The name of a part, as listed by scene. Not for interference or bed.'),
  b: z.string().optional().describe('The name of the other part, for overlap and clearance only.'),
  layout: z.string().optional().describe('The layout the parts are in, as listed by scene. Default: print for overhang, thin and bed when the model has it, else the one on screen.'),
  angle: loose(z.number()).optional().describe('For overhang: how far from vertical a face may lean before it overhangs, in degrees, above 0 and below 90. Default: the material\'s in the project\'s print profile, else 45.'),
  min: loose(z.number()).optional().describe('For thin: the least wall, in mm. Default: the print profile\'s (the material\'s, else two nozzle widths).'),
  size: loose(z.array(z.number())).optional().describe('For bed: the build volume of the printer, [x, y, z] in mm. Default: the bed of the project\'s print profile.'),
  fit: loose(z.enum(['press', 'sliding', 'loose'])).optional().describe('For clearance: judge the gap against that fit of the material in the project\'s print profile (per side); the reply says whose numbers they are.')
}

// Loose: what is not a list of refs or a number reaches the tool, which says what it takes (`tryFilletTool`).
const tryFilletInput = {
  part: loose(z.string()).optional().describe('The name of a part, as listed by scene: "lid".'),
  edges: loose(z.array(z.string())).optional().describe('Refs of edges of that part, as describe, look and the pointer give them: ["lid/E3", "lid/E7"]; 200 at most.'),
  radius: loose(z.number()).optional().describe('The radius of the fillet, or the length of the chamfer, in mm.'),
  kind: loose(z.enum(['fillet', 'chamfer'])).optional().describe('fillet (the default) or chamfer, of equal lengths.'),
  layout: z.string().optional().describe('The layout the part is in, as listed by scene. Default: the one on screen.')
}

// Loose: what is not an object of values, or a list of objects, reaches the tool, which says what it takes (`tryParamsTool`).
const tryParamsInput = {
  set: loose(z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))).optional().describe('The fields of the model\'s Params to try other values for, as scene lists them under params with an editable kind: {"wall": 2.4, "lid": false, "shape": "square"}. A number for a float or an int, a bool, or one of a Literal\'s values.'),
  measure: loose(z.array(z.record(z.string(), z.unknown()))).optional().describe('Measurements to take on the trial, as measure takes them but of whole parts by name only: [{"kind": "bbox", "a": "lid"}, {"kind": "distance", "a": "lid", "b": "base"}]. kind is bbox, volume, area, mass or distance. 10 at most.'),
  check: loose(z.array(z.record(z.string(), z.unknown()))).optional().describe('Checks to run on the trial, as check takes them, parts by name: [{"kind": "clearance", "a": "lid", "b": "base"}]. 10 at most.'),
  layout: z.string().optional().describe('The layout the measurements and checks are of unless one names its own. Default: the one on screen.')
}

// Loose: what is not a list of kinds reaches the tool, which says what it takes (`featuresTool`).
const featuresInput = {
  part: loose(z.string()).optional().describe('The name of a part, as listed by scene: "lid".'),
  kinds: loose(z.array(z.enum(['hole', 'boss', 'fillet', 'chamfer', 'pattern']))).optional().describe('What to look for: hole, boss, fillet, chamfer, pattern (holes or bosses alike at equal steps on a line, in a grid or on a circle). Default: all of them.'),
  layout: z.string().optional().describe('The layout the part is in, as listed by scene. Default: the one on screen.')
}

const resolveMarkInput = {
  id: z.string().describe('The number of the mark: M3.'),
  note: z.string().optional().describe('What was done about it, in a line, for the user.')
}

export interface MarksArgs {
  status?: 'draft' | 'sent' | 'resolved' | 'open'
  ids?: string[]
  limit?: number
  next?: string
  layout?: string
}
export interface DescribeArgs {
  ref: string
  layout?: string
}
export interface HighlightArgs {
  refs: string[]
  note?: string
  layout?: string
}
export interface AskArgs {
  question: string
  options: Array<{ label: string; refs?: string[] }>
  pick?: boolean
  layout?: string
}
export interface ShowArgs {
  /** A standard view, the name of a saved view, or a camera. */
  view?: string | CameraArg
  layout?: string
  parts?: string[]
  section?: PlaneArg | null
  scans?: string[]
  scanOpacity?: number
  explode?: ExplodeArg | null
  focus?: FocusArg
  margin?: number
}
export interface AddMarkArgs {
  kind: 'pin' | 'pick' | 'arrow' | 'shape' | 'dimension'
  note: string
  ref?: string
  point?: Vec3
  to?: Vec3
  by?: Vec3
  shape?: ShapeKind
  size?: Vec3
  position?: Vec3
  rotation?: Quat
  intent?: ShapeIntent
  measure?: MeasureKind
  a?: EndArg
  b?: EndArg
  expected?: number
  tolerance?: number
  layout?: string
}
export interface ResolveMarkArgs {
  id: string
  note?: string
}

/**
 * What a client is told of a tool beside its description (MCP's `annotations`). Claude Code runs the calls of
 * tools that only read side by side, so every tool that reads says so; annotations change nothing of what
 * `--allowedTools` permits. `look` reads: the picture it writes under `.torno/views/` is torno's own. No tool
 * reaches outside the object, so `openWorldHint` is false for all.
 */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }
/** What changes the person's view or the marks, never the model or a file of theirs. */
const CHANGES_VIEW_OR_MARKS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
/**
 * The tools Claude Code loads at the start of a session (`_meta`), where its tool search would otherwise leave
 * every one of them to be searched for first: those an agent needs on nearly every turn. Each one costs context in
 * every turn and is part of the prompt cache's prefix, so the list is short; changing it is a cache miss for
 * running sessions only.
 */
const ALWAYS_LOADED = { 'anthropic/alwaysLoad': true }

export const TOOLS = {
  scene: {
    title: 'Scene and build',
    annotations: READ_ONLY,
    meta: ALWAYS_LOADED,
    inputSchema: sceneInput,
    description:
      'Returns JSON for the project this session works on: the build status, revision and error, output (the last lines the model printed in the build that ended last, failed or good, outputCut when earlier lines were left out), its layouts, every part with size, bounding box, volume, face and edge counts in mm (sizeExact and volumeExact say whether the size and the volume are exact; reversed, only where there is any, lists the part’s solids turned inside out; solids is how many it has, openShells, only above 0, how many of its shells are not closed, and meshDisagrees with meshVolume, only then, that its mesh encloses other than its volume), what the user sees (layout, visible parts, camera, section, and explode when they have the parts drawn apart for display), under views the views saved by name (whose each is, its layout, whether it holds a section or an explode, how many parts it hides), and, under dimensions, how many of the unresolved dimensions pass, fail and are not measured on that revision, and under scans the scans the user imported, each with how its alignment in that layout stands, in a word (call scans for the whole of it), under groups the groups of parts the model’s groups(p) declares, each with its parts in the layout shown and whether they are visible (all, some, none), each part naming its group; a group name can be given wherever parts are named, under checks the checks the model’s own checks(p) declares, each with its status (pass, fail, error when it could not be measured, not run), value, unit, the least and most wanted, and whether it is exact (a pass is what was measured, never proof; a thin wall is found by sampling), and under checksEasier any of them removed or made easier to pass since a build, and under params the fields of the model’s Params dataclass as the kernel read them from the source: name, type as written, default (the value Params() holds, null when it is no plain value), literal (whether the default in the source is a literal; an expression or a default_factory is not) and doc (the field’s comment, or null; to change one, edit its default in the model file), and value (what this build used: it differs from default when the person has tried another value in torno, which is then told under paramsTried with those let go of; the file always wins, so to bake a tried value in, edit the default). It lists the parts of one layout (the one on screen, or layout) and counts those of the others, and past 200 parts, or when the list would not fit, gives the name, size and group of each part only (partsTruncated; describe gives the rest), so call it after every edit of the model to check that the build passed. Sizes and volumes here are for orientation (sizeExact and volumeExact say which are exact): call measure for a number to rely on.'
  },
  look: {
    title: 'Look at the view',
    annotations: READ_ONLY,
    meta: ALWAYS_LOADED,
    description:
      "Returns a PNG of the project drawn by the same viewport the user is looking at, with a caption naming the view, layout, parts, the scans drawn with them (and of each whether it is aligned there), revision and whether the parts are stale. Call it with no arguments to see exactly what the user sees, or with a named view, a camera, a layout or a list of parts to check the shape after a change, or with focus (a ref, a mark or a box) to see one detail up close.",
    inputSchema: lookInput
  },
  marks: {
    title: 'List marks',
    annotations: READ_ONLY,
    meta: ALWAYS_LOADED,
    description:
      "Returns JSON with the revision of the build it is of, a stale note when a newer build is running or failed, and the marks on this project, the user's and your own: each with its number (M3), kind, note, status, layout, the ref and descriptor of what it is on, its coordinates in mm in the frame of its layout, for a stroke a summary of its points (pointsSummary: count, first, last and box; all of them only when you name it in ids), and a line that says it in words; a region is a part of a scan the user painted and named with its note (\"wiring loom, can be pushed aside\"): it holds scan, triangles, area, its size along its own axes and whether it is flat, and, where its scan is aligned in the layout asked (toldIn), centroid, axes, the box it lies within (bbox) and plane in the frame of that layout, all approximate, with alignment saying in a word how that alignment stands (aligned, rough, in doubt, not checked), and its number is what scan_clash takes in ignore, scan_deviation in region and measure as an end; a dimension also holds value, how, points and verdict when they were measured on that revision (its measuredRevision), wasValue and wasRevision in their place when what it holds is of an older build, and resolvedValue, resolvedVerdict and resolvedOnRevision once it is resolved and no longer measured. Marks are how the user points at the part; new ones are told to you with the prompt, a line each, so call this for their data, or when you are told that more marks were left out; it lists the open ones, 50 at a time (omitted says how many were left out and next where to go on; status resolved or ids gives the others). An anchorState other than ok means the build moved the surface or dropped the part, and a checkedRevision that is absent or is not the revision means the mark has not been checked against that build: either way the ref may no longer name what the mark is on.",
    inputSchema: marksInput
  },
  describe: {
    title: 'Describe a part, face or edge',
    annotations: READ_ONLY,
    meta: ALWAYS_LOADED,
    description:
      'Returns JSON with the exact geometry of a part, a face or an edge, or of a group (a group name, as scene lists them: the box of its parts and their total volume, exact only where every part\'s is, with reversed by part where one has a solid inside out): its type, size, area or length, centre, normal or radius, a one-line descriptor (of a part its box and volume, with bboxExact and volumeExact, and reversed where a solid of it is turned inside out), the revision of the build it was measured on, and a stale note when a newer build is running or failed; an area with areaExact false is approximate (≈ in the descriptor), as that of a freeform face always is, and so are the box and the volume of a part where bboxExact or volumeExact is false. Refs come from marks, scene and earlier describe calls; face and edge numbers change when the model is rebuilt, so describe a ref again after an edit before relying on it. A face or an edge also gets a selector: a build123d expression on part (part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[-1]) that the kernel evaluated on this build and that gave exactly that shape, with robust \'by geometry\' (a direction, an extreme, a radius, a place) or \'by order\' (an index into a sort, which the next edit may break), and selectorFrame saying whose frame its directions are in (a layout that moves or turns the part gives its own); selector is null, with selectorWhy, when none picks only that shape; paste it into the model instead of writing one from the descriptor, and look at the result, as it is right for this build only.',
    inputSchema: describeInput
  },
  highlight: {
    title: 'Highlight on the view',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      "Returns which refs are now tinted in the user's viewport in your colour, with your note beside them, until the user clicks there or 60 s pass. Use it to ask \"this one?\" before a change that would be costly to get wrong, and then wait for the answer.",
    inputSchema: highlightInput
  },
  ask: {
    title: 'Ask the user to choose',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      "Returns the answer of the user to a question you put as a card in their chat and under their viewport, and waits for it: the option they chose, with its label and refs, or, with pick, the face or edge they selected, or that they declined. Pointing at an option lights its refs in their viewport, and the call ends with not answered after 10 minutes or when they stop the turn. Use it instead of highlight when you need to know which face, edge or part they mean before a costly change; the answer is data, so you need not turn the left one back into a ref.",
    inputSchema: askInput
  },
  show: {
    title: 'Change the view',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      "Returns a caption of what the user's viewport shows after it was changed to the view, layout, parts, section, explode or scans you gave. It moves the user's own camera, hides the parts and the scans you leave out and cuts their view or draws its parts apart, so use it only to show them something, and say that you did; to see for yourself, call look. Give focus to put their camera on a ref, a mark or a box.",
    inputSchema: showInput
  },
  save_view: {
    title: 'Propose a saved view',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      'Returns the view you proposed, as kept in the user\'s strip of saved views marked "proposed" until they keep or discard it, and the revision it was saved on. Use it to leave the user a way back to something you showed them: the view of a problem, of a fit, of a change. It changes nothing on their screen; to show it now, call show with its name.',
    inputSchema: saveViewInput
  },
  add_mark: {
    title: 'Add a mark',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      `Returns the number and a one-line description of a mark you placed on the project, which the user sees in the viewport and in their list of marks in your colour, and the revision of the build it was placed on. Use it to show where you made a change, or to point at the place a question is about, as {"kind": "pin", "ref": "lid/F12", "point": [10, 0, 22], "note": "thinned this wall to 2 mm"} does; refs come from marks, scene and describe. A dimension is measured at once, in mm or degrees, and again on every build, and one you give an expected value becomes a pinned check the user sees: it is told to you again with every prompt for as long as it fails.`,
    inputSchema: addMarkInput
  },
  resolve_mark: {
    title: 'Resolve a mark',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      "Returns the mark, now resolved: the user sees it in their list as resolved by you, with your note, until they confirm or reopen it. Call it for each mark of the user's once you have acted on it and checked the result. A dimension of the user’s with an expected value is not yours to resolve, since it is their check of the part and passes by itself, and any other dimension you resolve is no longer measured on later builds.",
    inputSchema: resolveMarkInput
  },
  measure: {
    title: 'Measure',
    annotations: READ_ONLY,
    meta: ALWAYS_LOADED,
    description:
      "Returns JSON with one measurement of the last build and a reading of it in a line: the distance or angle between two ends, the radius or diameter of a round face or edge, the thickness of a wall at a point of a face, or the bbox, volume, area or mass of a part, in mm, degrees, mm², mm³ and grams, with how it was taken (between planes, axis to axis, minimum). Values are exact, from the B-rep, unless the reply has exact false and the reading says approximate (≈): the area of a freeform face always is, and so are the volume and the mass of a part with one and the bbox of any part but one of planes and cylinders, and how then says about how many digits are good, or, with no digit count, by how much it is in doubt; and so is any distance to a point of a scan, which is a mesh of the real thing and only as good as its alignment. Measure before you state a size or a fit, instead of working it out from the model's code or writing a script.",
    inputSchema: measureInput
  },
  section: {
    title: 'Cut a section',
    annotations: READ_ONLY,
    description:
      "Returns a 2D drawing and JSON of what a plane cuts of the parts: for each part its outlines from the B-rep, as loops of [u, v] points in mm along the plane's own axes (x and y in the reply), with their areas in mm² (negative round a hole) and the extent of the whole cut. A loop is a polyline within its deflection of the true outline (0.01 mm unless you give another, more when thinned: an answer holds at most 1,500 points in all, the parts' outlines and a scan's lines together, shared by their length, and says thinned, points, of and loopsOmitted when it left any out), and an area is the kernel's, exact only where areaExact is true. Use it to see inside a part and to check a wall or a fit across a cut, with scan to see where that scan crosses the same plane (drawn dashed and given under scan, approximate); to see the cut in 3D as the user would, call look with a section.",
    inputSchema: sectionInput
  },
  check: {
    title: 'Run a check',
    annotations: READ_ONLY,
    description:
      'Returns JSON and a reading in a line of one check of the last build: overlap is the volume two parts share, in mm³; clearance the least distance between two parts, in mm, with the points it is between; interference every pair of the layout at once ({"kind": "interference"}): the pairs of solid parts that share volume, each with the volume and the box it lies in, the pairs that only touch, and how many are clear; mesh whether the mesh a part is drawn and exported with is closed, with where its open edges are; and, of the print layout, overhang the faces of a part that face down steeper than angle from vertical (refs such as tray/F7, with their areas; faces on the bed left out; curved faces judged by sampled normals, approximate), thin where its walls are under min mm, sampled over its faces (always approximate), and bed whether the layout fits a bed of size [x, y, z] mm, and by how much it does not on each axis ({"kind": "bed", "size": [256, 256, 256]}). A clearance is exact, from the B-rep, unless the reply says approximate; what two parts share is exact of parts all planes and round faces and approximate (≈, volumeExact false, how saying how many digits are good) of freeform ones; overlap, mesh and thin can take seconds on large parts, and interference up to 20 s (it says how many pairs it measured when the time runs out); a bed fit is exact only where every box is. Use it after changing parts that must fit together, and before saying a part is ready to print.',
    inputSchema: checkInput
  },
  diff: {
    title: 'Compare two builds',
    annotations: READ_ONLY,
    description:
      "Returns JSON of what changed between two successful builds (by default the one before the last and the last; any of the last 100 builds, and every one the person starred, is kept in the history and named by its id, h41, or, if made in this run, by its revision): for each layout the parts added and removed, and for each part in both its volume, the size of its box and its min corner, before, after and the change in mm and mm³, each with exact (false where either build's number is approximate, as scene's sizeExact and volumeExact say), its face, edge and solid counts before and after, changed, and a line saying what changed (the volume's change also in percent; a number that is not exact has changed only by more than both builds' doubt of it). `builds` says what each build was made from: a hash of the sources, and the commit then checked out, with dirty when files differed from it, and, of a kept build, its id and the checks, defects and dimensions it had then (as of then, never how it stands now). Call it after an edit to see what it did, or against a kept build to see what changed since; numbers are the kernel's of each build, for orientation (call measure for one to rely on), and face or edge counts that changed mean refs such as lid/F12 may name other faces now, so describe a ref again before relying on it.",
    inputSchema: diffInput
  },
  history: {
    title: 'List the builds kept',
    annotations: READ_ONLY,
    description:
      "Returns JSON of the builds torno kept of this project under .torno/history/, newest first: for each its id (h41, which counts on across runs of torno), when it was made, its revision if it was made in this run, what changed from the build kept before it in a line that also says what caused it (by Claude under which prompt, the person's own edit, params, a go back to an earlier build, or nothing for a build kept before torno said), whether a go back undid it, and, for a build that failed to build (kept as a line, with no scene or copies: diff refuses it), the line of its error, the checks of the model that failed and the parts with a defect in it (a build that fails them is kept all the same), how the person's dimensions stood when it was checked (as of then, never how they stand now), what sources it was made from, and whether the person starred it. With id, that build alone, with the paths of the copies of its Python files: read them to go back to that build, then edit the project's own files to match, since a copy is not to be edited and torno restores files only when the person chooses Go back in the window, after confirming (you are told when it has). Use it to find the build to compare with diff, or to go back to.",
    inputSchema: historyInput
  },
  board: {
    title: 'Read the board',
    annotations: READ_ONLY,
    description:
      'Returns the board of this project as text: each card by its id, its kind and who made it with what it says, frames first with their cards in reading order, then the arrows between them, and the pictures named, or sent with pictures: true. The board is the person\'s brief, where they lay out what they want, so read it when they point at a frame or a card, and before you plan. {"frame": "Latch"} gives only that frame and its cards.',
    inputSchema: boardInput
  },
  add_card: {
    title: 'Add a card to the board',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      'Returns the id of the card you added to the person\'s board, and of the frame or the arrow when you made one, or why it was refused. Use it to leave a plan, a note or a picture of the view where they can follow it: {"text": "Widen the latch by 2 mm", "frame": "Latch"}, or look to draw the view as the look tool does. It puts the card in a free spot and never moves, changes or removes a card of theirs; card with text or remove changes or takes down one of your own.',
    inputSchema: addCardInput
  },
  expect: {
    title: 'Say what an edit should change',
    annotations: CHANGES_VIEW_OR_MARKS,
    description:
      "Returns JSON that says what was kept, and holds the next successful build against what an edit should change, once the build lands: the answer to the edit then says how many checks were met and which not, with the numbers (≈ where the kernel's is not exact, judged within its doubt; a ref of a face or edge of a part whose face or edge count changed is told as moved and not measured). A check is a part's volume, faces, edges or size as a value or a change, a measurement with its expected value, or parts that stay unchanged. Call it before an edit to state what it should do; it is yours, held in memory for that one build, no mark, and never holds anything back; scene gives the last verdict.",
    inputSchema: expectInput
  },
  try_fillet: {
    title: 'Try a fillet or chamfer',
    annotations: READ_ONLY,
    description:
      "Returns JSON and a reading of a fillet (or a chamfer) of radius mm of some edges of a part, tried by the kernel on the last build that worked and thrown away: works, and when it does not, why: the edges that fail alone, else the pairs that fail (those that share a face first, with how far apart they are), and the largest radius that works for them all and for each edge that fails alone, bisected to 0.001 mm within the query's 30 s (complete false when time ran out), each edge named by its ref of that build, with its ends in the frame of the layout. It changes nothing: the model is yours to edit, and a ref may name another edge after it changes. Call it before you edit a fillet or a chamfer again after one failed, with the edges the build's error names (a ref where it is one of the last build), instead of lowering the radius blind or wrapping it in try.",
    inputSchema: tryFilletInput
  },
  try_params: {
    title: 'Try other params',
    annotations: READ_ONLY,
    description:
      "Returns JSON and a reading of what the model gives with other values of its Params (set: the fields scene lists under params with an editable kind), built in a worker of its own and thrown away: whether it built or the model's error, what changed against the last build part by part, and the measurements and checks you ask for (measure and check, of whole parts by name), each worded as those tools word them and said to be of the trial. Use it to search a value (\"which clearance gives 0.3 mm between lid and base\") instead of editing the model and building again; it changes nothing, the person's values included, keeps no ref of the trial, is made over the values the person is trying (scene says), and is refused while a build runs or when there is no room for a second one. To keep a value, edit its default in the model.",
    inputSchema: tryParamsInput
  },
  features: {
    title: 'List features of a part',
    annotations: READ_ONLY,
    description:
      "Returns JSON and a reading of the holes, bosses, fillets, chamfers and patterns of a part of the last build that worked, found on its B-rep: for each hole its diameter, axis (pointing into the part), entry point, the face it opens in, depth, whether it is through or blind (and its bottom), and any counterbore, countersink or rounded mouth; for each boss its diameter, height and base; for each fillet its radius, sweep and length, whether it rounds an outside edge or an inside corner, and the faces and edges it joins; for each chamfer its setback (or setbacks, when uneven) in the same way; for each pattern of holes or bosses alike how many there are and whether they lie in a row, a grid or on a circle, with the step; with the faces each is made of, as refs that describe and highlight take. Diameters, radii, angles, axes and depths between planes and round faces are exact, a depth taken between freeform faces says it is not (exact false, ≈ in the reading), and only analytic faces count: cylinders, cones and tori that go all the way round for holes and bosses, blends tangent to both faces for fillets, so slot ends are counted as arcs and told as neither (at most 100 of a kind are listed, the rest counted). Use it to answer how many holes there are, of what size and how deep, what the fillets are, and before you edit any of them, instead of describing faces one by one.",
    inputSchema: featuresInput
  },
  scans: {
    title: 'List scans',
    annotations: READ_ONLY,
    description:
      'Returns JSON and a reading of the scans the user imported into this project: each with its number (S1), name, source file and whether that is still there, triangle count, size in mm with the unit and up axis it was read with, whether it is on screen and how see-through, its regions, and how it is aligned in the layout: by a floor, by pairs of points with their rms, by hand, or not at all, with why that is only rough or may no longer hold when the model has moved under it since. A scan is a mesh of the real surroundings, good to a few millimetres at best: nothing from it is exact. Call it before any check against a scan.',
    inputSchema: scansInput
  },
  scan_clash: {
    title: 'Find where a scan meets a part',
    annotations: READ_ONLY,
    description:
      "Returns JSON and a reading of what of a scan is inside a part of the last build: how many scan points, in which clusters (centre, box, count), the deepest of each with its depth and the face it is under, how many scan triangles cross the part's surface and where (crossings), and the scan point nearest to the part outside it; ignore leaves out regions by mark number. Counts are of scan vertices, decided on the mesh the part is drawn with, of those checked (the reading says when only every n-th was, or the time ran out), each depth and distance told is from that scan point to the part's B-rep, and all of it is approximate by nature: the scan is, and so is its alignment, whose rms the reply gives and whose doubts the reading says first. Refused where the scan is not aligned, and for a part torno moved for display; use it instead of a script that loads the scan.",
    inputSchema: scanClashInput
  },
  scan_deviation: {
    title: 'Measure a part against a scan',
    annotations: READ_ONLY,
    description:
      "Returns JSON and a reading of how far a part, or some of its faces, lie from a scan: min, mean, max, rms and percentiles in mm over up to 20,000 sample points (samples is how many were measured, sampling.asked how many you asked for), signed where the part is a solid (+ where the scan is outside it, − where it is inside), the worst place, and how many samples had nothing within reach. from part samples the part and measures to the scan's triangles, from scan measures from the scan's vertices (of a region, if one is given) to the part; all of it is approximate, no better than the alignment, and refused where the scan is not aligned, and for a part torno moved for display. Use it to judge an alignment against a reference part the scan contains, or how close the surroundings come to a face.",
    inputSchema: scanDeviationInput
  }
}

/**
 * What the server tells a client at `initialize`, which Claude Code shows from the start of a session even for the
 * tools its tool search keeps back: so the words an agent would search with are here (measure, wall thickness,
 * section, clearance, picture, marks). A line for every tool, the reading ones first; a tool added to `TOOLS` is
 * added here (`schemas.test.ts` holds both). Claude Code cuts it at `INSTRUCTIONS_LIMIT` characters.
 */
export const INSTRUCTIONS_LIMIT = 4096
export const SERVER_INSTRUCTIONS = `torno's server reads and measures the CAD part of the project this session works on, and shows things to the person looking at it in the torno window. Every answer is from the last build that worked, says which revision that is, and says so when a newer build is running or has failed. Numbers from measure, check, section and diff are the B-rep's and say whether they are exact; scene's sizes are for orientation. Check an edit by numbers first, then one look. The tools that only read may be called together.

- scene: the build status and error, what the model printed, layouts, parts with size and volume, groups, params, saved views, the person's camera, section and explode. Start here.
- look: a picture of the part as the person's viewport draws it, with the marks, from any view, camera, layout, section or explode, or framed close on one face, edge, mark or box.
- marks: the person's marks (pins, picks, arrows, strokes, shapes, dimensions, regions of a scan) and yours, with notes, status and what each is on.
- describe: the exact geometry of a part, a face, an edge, a group of parts or a mark: area, centre, normal, radius, volume, box; of a face or an edge also a build123d selector that picks it now.
- measure: one exact number: distance or angle between two ends, radius, diameter, wall thickness, area, volume, mass, bounding box.
- section: the outlines a plane cuts of the parts, with their areas, and a 2D drawing of the cut.
- check: overlap and clearance between parts, interference of a whole layout, a closed mesh, and for printing overhangs, thin walls and the fit on a bed.
- diff: what changed between two successful builds (the last two, or any kept ones): parts added or removed, volume, size and face counts.
- history: the builds kept of this project, by id (h41), with what changed in each; diff compares any two.
- board: the person's board, where they lay out what they want: text, pictures, frames and arrows, and cards for their marks, scans, references and pinned builds; read a frame by name.
- add_card: leave a card of yours on the board (a plan, a note, a picture of the view), in a frame, with an arrow; change or remove only your own.
- expect: say before an edit what it should change (volume, faces, size, a measurement, parts unchanged); the build after it is checked against that.
- try_fillet: try a fillet or chamfer of some edges on the last build and throw it away: whether it works, the largest radius that does, which edges or pairs fail.
- try_params: build the model with other values of its Params in a throwaway worker and measure or check there, to search a value without editing the model.
- features: the holes (diameter, depth, through or blind, counterbore, countersink), bosses, fillets (radius), chamfers (size) and patterns (4 holes on a square, a bolt circle) of a part, exact, with the faces they are made of.
- scans: the scans the person imported, and how each is aligned to the model.
- scan_clash: what of a scan is inside a part, as clusters with their depth.
- scan_deviation: how far a part, or some of its faces, lie from a scan (min, mean, max, percentiles).
- highlight: tint faces or edges in the person's viewport with a note, to ask "this one?" before a costly change.
- ask: ask the person to choose between options whose answers are refs, or to pick a face or edge, and wait for the answer.
- show: change the person's camera, layout, visible parts, section, explode or scans, put a saved view on screen, or point their camera at a ref, mark or box.
- save_view: propose a saved view to the person's strip, for them to keep or discard.
- add_mark: leave a mark of yours (pin, pick, arrow, shape, or a dimension measured on every build).
- resolve_mark: resolve a mark of the person's with a line on what was done, for them to confirm or reopen.`

/** The keys each tool takes: those its schema names. */
const KEYS = Object.fromEntries(Object.entries(TOOLS).map(([name, tool]) => [name, Object.keys('inputSchema' in tool ? tool.inputSchema : {})])) as Record<keyof typeof TOOLS, string[]>

/** Why a tool was given a key it does not take, as the error to answer with, or null (`unknownKeys`). */
export function refusedKeys(name: keyof typeof TOOLS, args: unknown): ToolResult | null {
  const wrong = unknownKeys(args, KEYS[name], name)
  return wrong === null ? null : failure(wrong)
}
