import { z } from 'zod'
import type { ExplodeState } from '../../shared/explode'
import type { MeasureKind, Quat, ShapeIntent, ShapeKind } from '../../shared/marks'
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
const scanText = 'The number of a scan (S1), as listed by scans. Default: the only scan of the object.'
// Loose: a key a camera does not take reaches the tool, which refuses it by name (`cameraKeys`).
// A camera is what `scene` and a mark give as one, whole: the agent reads the view, shows something, and puts the view back.
export const cameraInput = z.looseObject({ position: vec3, target: vec3, up: vec3.optional(), ortho: z.boolean().optional(), fov: z.number().optional(), zoom: z.number().optional() })
export const CAMERA_KEYS = ['position', 'target', 'up', 'ortho', 'fov', 'zoom']

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
    .describe(`How far apart the parts are drawn in the picture: ${explodeHelp} The caption says when a picture is exploded. null or 0 draws them together. Default: as on the user's screen. Not with a section.`)
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
}

/** An explode as the agent gives one: the amount alone, or with an axis and a scale. */
export type ExplodeArg = number | (Pick<ExplodeState, 'amount'> & Partial<ExplodeState>)

type Vec3 = [number, number, number]

const refText = 'A ref names a part (lid), one of its faces (lid/F12) or edges (lid/E3), as given by marks, scene and describe.'
const layoutText = 'The layout the refs are of, as listed by scene. Default: the one on screen.'

const marksInput = {
  status: z
    .enum(['draft', 'sent', 'resolved', 'open'])
    .optional()
    .describe('Only the marks of that status: draft (not yet told to you), sent, resolved, or open for all that are not resolved. Default: all.'),
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
    .describe(`How far apart the parts are drawn on the user's screen, for now only: ${explodeHelp} null or 0 puts them together. Default: as they are. Not with a section: pass section null with it when their view is cut.`)
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
  density: z.number().optional().describe('For mass: g/cm³. Default 1.24, PLA, and the reply says so.'),
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

const diffInput = {
  from: z.number().int().optional().describe('The revision to compare from, as scene and the build status give it. Default: the successful build before the last.'),
  to: z.number().int().optional().describe('The revision to compare to. Default: the last successful build.')
}
const checkInput = {
  kind: z.enum(['overlap', 'clearance', 'mesh', 'overhang', 'thin', 'bed']).describe('overlap and clearance are of the two parts a and b; mesh, overhang and thin are of the part a; bed is of the whole layout.'),
  a: z.string().optional().describe('The name of a part, as listed by scene. Not for bed.'),
  b: z.string().optional().describe('The name of the other part, for overlap and clearance.'),
  layout: z.string().optional().describe('The layout the parts are in, as listed by scene. Default: print for overhang, thin and bed when the model has it, else the one on screen.'),
  angle: loose(z.number()).optional().describe('For overhang: how far from vertical a face may lean before it overhangs, in degrees, above 0 and below 90. Default 45.'),
  min: loose(z.number()).optional().describe('For thin: the least wall, in mm.'),
  size: loose(z.array(z.number())).optional().describe('For bed: the build volume of the printer, [x, y, z] in mm.')
}

const resolveMarkInput = {
  id: z.string().describe('The number of the mark: M3.'),
  note: z.string().optional().describe('What was done about it, in a line, for the user.')
}

export interface MarksArgs {
  status?: 'draft' | 'sent' | 'resolved' | 'open'
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
export interface ShowArgs {
  /** A standard view, the name of a saved view, or a camera. */
  view?: string | CameraArg
  layout?: string
  parts?: string[]
  section?: PlaneArg | null
  scans?: string[]
  scanOpacity?: number
  explode?: ExplodeArg | null
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

export const TOOLS = {
  scene: {
    description:
      'Returns JSON for the object this session works on: the build status, revision and error, its layouts, every part with size, bounding box, volume, face and edge counts in mm (sizeExact and volumeExact say whether the size and the volume are exact), what the user sees (layout, visible parts, camera, section, and explode when they have the parts drawn apart for display), under views the views saved by name (whose each is, its layout, whether it holds a section or an explode, how many parts it hides), and, under dimensions, how many of the unresolved dimensions pass, fail and are not measured on that revision, and under scans the scans the user imported, each with how its alignment in that layout stands, in a word (call scans for the whole of it), under groups the groups of parts the model’s groups(p) declares, each with its parts in the layout shown and whether they are visible (all, some, none), each part naming its group; a group name can be given wherever parts are named, and under params the fields of the model’s Params dataclass as the kernel read them from the source: name, type as written, default (the value Params() holds, null when it is no plain value), literal (whether the default in the source is a literal; an expression or a default_factory is not) and doc (the field’s comment, or null; to change one, edit its default in the model file). Call it after every edit of the model to check that the build passed. Sizes and volumes here are for orientation (sizeExact and volumeExact say which are exact): call measure for a number to rely on.'
  },
  look: {
    description:
      "Returns a PNG of the object drawn by the same viewport the user is looking at, with a caption naming the view, layout, parts, the scans drawn with them (and of each whether it is aligned there), revision and whether the parts are stale. Call it with no arguments to see exactly what the user sees, or with a named view, a camera, a layout or a list of parts to check the shape after a change.",
    inputSchema: lookInput
  },
  marks: {
    description:
      "Returns JSON with the revision of the build it is of, a stale note when a newer build is running or failed, and the marks on this object, the user's and your own: each with its number (M3), kind, note, status, layout, the ref and descriptor of what it is on, its coordinates in mm in the frame of its layout, for a stroke its points, and a line that says it in words; a region is a part of a scan the user painted and named with its note (\"wiring loom, can be pushed aside\"): it holds scan, triangles, area, its size along its own axes and whether it is flat, and, where its scan is aligned in the layout asked (toldIn), centroid, axes, the box it lies within (bbox) and plane in the frame of that layout, all approximate, with alignment saying in a word how that alignment stands (aligned, rough, in doubt, not checked), and its number is what scan_clash takes in ignore, scan_deviation in region and measure as an end; a dimension also holds value, how, points and verdict when they were measured on that revision (its measuredRevision), wasValue and wasRevision in their place when what it holds is of an older build, and resolvedValue, resolvedVerdict and resolvedOnRevision once it is resolved and no longer measured. Marks are how the user points at the part; new ones are told to you with the prompt, a line each, so call this for all of their data, or when you are told that more marks were left out. An anchorState other than ok means the build moved the surface or dropped the part, and a checkedRevision that is absent or is not the revision means the mark has not been checked against that build: either way the ref may no longer name what the mark is on.",
    inputSchema: marksInput
  },
  describe: {
    description:
      'Returns JSON with the exact geometry of a part, a face or an edge, or of a group (a group name, as scene lists them: the box of its parts and their total volume, exact only where every part\'s is): its type, size, area or length, centre, normal or radius, a one-line descriptor (of a part its box and volume, with bboxExact and volumeExact), the revision of the build it was measured on, and a stale note when a newer build is running or failed; an area with areaExact false is approximate (≈ in the descriptor), as that of a freeform face always is, and so are the box and the volume of a part where bboxExact or volumeExact is false. Refs come from marks, scene and earlier describe calls; face and edge numbers change when the model is rebuilt, so describe a ref again after an edit before relying on it.',
    inputSchema: describeInput
  },
  highlight: {
    description:
      "Returns which refs are now tinted in the user's viewport in your colour, with your note beside them, until the user clicks there or 60 s pass. Use it to ask \"this one?\" before a change that would be costly to get wrong, and then wait for the answer.",
    inputSchema: highlightInput
  },
  show: {
    description:
      "Returns a caption of what the user's viewport shows after it was changed to the view, layout, parts, section, explode or scans you gave. It moves the user's own camera, hides the parts and the scans you leave out and cuts their view or draws its parts apart, so use it only to show them something, and say that you did; to see for yourself, call look.",
    inputSchema: showInput
  },
  save_view: {
    description:
      'Returns the view you proposed, as kept in the user\'s strip of saved views marked "proposed" until they keep or discard it, and the revision it was saved on. Use it to leave the user a way back to something you showed them: the view of a problem, of a fit, of a change. It changes nothing on their screen; to show it now, call show with its name.',
    inputSchema: saveViewInput
  },
  add_mark: {
    description:
      `Returns the number and a one-line description of a mark you placed on the object, which the user sees in the viewport and in their list of marks in your colour, and the revision of the build it was placed on. Use it to show where you made a change, or to point at the place a question is about, as {"kind": "pin", "ref": "lid/F12", "point": [10, 0, 22], "note": "thinned this wall to 2 mm"} does; refs come from marks, scene and describe. A dimension is measured at once, in mm or degrees, and again on every build, and one you give an expected value becomes a pinned check the user sees: it is told to you again with every prompt for as long as it fails.`,
    inputSchema: addMarkInput
  },
  resolve_mark: {
    description:
      "Returns the mark, now resolved: the user sees it in their list as resolved by you, with your note, until they confirm or reopen it. Call it for each mark of the user's once you have acted on it and checked the result. A dimension of the user’s with an expected value is not yours to resolve, since it is their check of the part and passes by itself, and any other dimension you resolve is no longer measured on later builds.",
    inputSchema: resolveMarkInput
  },
  measure: {
    description:
      "Returns JSON with one measurement of the last build and a reading of it in a line: the distance or angle between two ends, the radius or diameter of a round face or edge, the thickness of a wall at a point of a face, or the bbox, volume, area or mass of a part, in mm, degrees, mm², mm³ and grams, with how it was taken (between planes, axis to axis, minimum). Values are exact, from the B-rep, unless the reply has exact false and the reading says approximate (≈): the area of a freeform face always is, and so are the volume and the mass of a part with one and the bbox of any part but one of planes and cylinders, and how then says about how many digits are good, or, with no digit count, by how much it is in doubt; and so is any distance to a point of a scan, which is a mesh of the real thing and only as good as its alignment. Measure before you state a size or a fit, instead of working it out from the model's code or writing a script.",
    inputSchema: measureInput
  },
  section: {
    description:
      "Returns a 2D drawing and JSON of what a plane cuts of the parts: for each part its outlines from the B-rep, as loops of [u, v] points in mm along the plane's own axes (x and y in the reply), with their areas in mm² (negative round a hole) and the extent of the whole cut. A loop is a polyline within its deflection of the true outline (0.01 mm unless you give another, more when thinned: an answer holds at most 1,500 points in all, the parts' outlines and a scan's lines together, shared by their length, and says thinned, points, of and loopsOmitted when it left any out), and an area is the kernel's, exact only where areaExact is true. Use it to see inside a part and to check a wall or a fit across a cut, with scan to see where that scan crosses the same plane (drawn dashed and given under scan, approximate); to see the cut in 3D as the user would, call look with a section.",
    inputSchema: sectionInput
  },
  check: {
    description:
      'Returns JSON and a reading in a line of one check of the last build: overlap is the volume two parts share, in mm³; clearance the least distance between two parts, in mm, with the points it is between; mesh whether the mesh a part is drawn and exported with is closed, with where its open edges are; and, of the print layout, overhang the faces of a part that face down steeper than angle from vertical (refs such as tray/F7, with their areas; faces on the bed left out; curved faces judged by sampled normals, approximate), thin where its walls are under min mm, sampled over its faces (always approximate), and bed whether the layout fits a bed of size [x, y, z] mm, and by how much it does not on each axis ({"kind": "bed", "size": [256, 256, 256]}). A clearance is exact, from the B-rep, unless the reply says approximate; what two parts share is exact of parts all planes and round faces and approximate (≈, volumeExact false, how saying how many digits are good) of freeform ones; overlap, mesh and thin can take seconds on large parts; a bed fit is exact only where every box is. Use it after changing parts that must fit together, and before saying a part is ready to print.',
    inputSchema: checkInput
  },
  diff: {
    description:
      "Returns JSON of what changed between two successful builds (by default the one before the last and the last; only those two are kept): for each layout the parts added and removed, and for each part in both its volume, the size of its box and its min corner, before, after and the change in mm and mm³, each with exact (false where either build's number is approximate, as scene's sizeExact and volumeExact say), its face and edge counts before and after, changed, and a line saying what changed. Call it after an edit to see what it did; numbers are the kernel's of each build, for orientation (call measure for one to rely on), and face or edge counts that changed mean refs such as lid/F12 may name other faces now, so describe a ref again before relying on it.",
    inputSchema: diffInput
  },
  scans: {
    description:
      'Returns JSON and a reading of the scans the user imported into this object: each with its number (S1), name, source file and whether that is still there, triangle count, size in mm with the unit and up axis it was read with, whether it is on screen and how see-through, its regions, and how it is aligned in the layout: by a floor, by pairs of points with their rms, by hand, or not at all, with why that is only rough or may no longer hold when the model has moved under it since. A scan is a mesh of the real surroundings, good to a few millimetres at best: nothing from it is exact. Call it before any check against a scan.',
    inputSchema: scansInput
  },
  scan_clash: {
    description:
      "Returns JSON and a reading of what of a scan is inside a part of the last build: how many scan points, in which clusters (centre, box, count), the deepest of each with its depth and the face it is under, how many scan triangles cross the part's surface and where (crossings), and the scan point nearest to the part outside it; ignore leaves out regions by mark number. Counts are of scan vertices, decided on the mesh the part is drawn with, of those checked (the reading says when only every n-th was, or the time ran out), each depth and distance told is from that scan point to the part's B-rep, and all of it is approximate by nature: the scan is, and so is its alignment, whose rms the reply gives and whose doubts the reading says first. Refused where the scan is not aligned, and for a part torno moved for display; use it instead of a script that loads the scan.",
    inputSchema: scanClashInput
  },
  scan_deviation: {
    description:
      "Returns JSON and a reading of how far a part, or some of its faces, lie from a scan: min, mean, max, rms and percentiles in mm over up to 20,000 sample points (samples is how many were measured, sampling.asked how many you asked for), signed where the part is a solid (+ where the scan is outside it, − where it is inside), the worst place, and how many samples had nothing within reach. from part samples the part and measures to the scan's triangles, from scan measures from the scan's vertices (of a region, if one is given) to the part; all of it is approximate, no better than the alignment, and refused where the scan is not aligned, and for a part torno moved for display. Use it to judge an alignment against a reference part the scan contains, or how close the surroundings come to a face.",
    inputSchema: scanDeviationInput
  }
}

/** The keys each tool takes: those its schema names. */
const KEYS = Object.fromEntries(Object.entries(TOOLS).map(([name, tool]) => [name, Object.keys('inputSchema' in tool ? tool.inputSchema : {})])) as Record<keyof typeof TOOLS, string[]>

/** Why a tool was given a key it does not take, as the error to answer with, or null (`unknownKeys`). */
export function refusedKeys(name: keyof typeof TOOLS, args: unknown): ToolResult | null {
  const wrong = unknownKeys(args, KEYS[name], name)
  return wrong === null ? null : failure(wrong)
}
