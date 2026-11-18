import type { AskAnswer, OpenAsk } from './ask'
import type { BoardAttach, BoardFile, BoardOpen, PersonChange, PinWhat } from './board'
import type { BuildState } from './build'
import type { TurnChanges } from './changes'
import type { AgentChoice, ChatAnswer, ChatHistory, ChatCommand, ChatItem, ChatMeta, ChatModel, Effort, Mode, PromptRow } from './chat'
import type { GitState } from './git'
import type { GoBackPlan, GoBackResult, HistoryGhost, HistoryList } from './history'
import type { ExportPlan, ExportRequest, ExportSaved } from './exportdata'
import type { Described, MeasureProbe, MeasuredOnce } from './geometry'
import type { InstructionFile } from './instructions'
import type { Anchor, Mark, MarkPatch, NewMark, NewRegion, NewStroke, NoteLabel, NoteStroke, Replacement, ReviewIntent, SketchPlane, SketchTake } from './marks'
import type { Scene } from './scene'
import type { SizeFact } from './size'
import type { AlignMade, NewAlignment, Reimported, ScanInfo, ScanUnit, ScanUp } from './scans'
import type { SceneFile } from './scenefile'
import type { ObjectCard, ThumbnailOf } from './show'
import type { HighlightRequest, HighlightResult, LookRequest, LookResult, SaveViewRequest, SaveViewResult, SectionDrawingRequest, SectionDrawingResult, ShowRequest, ShowResult, ViewState, Camera } from './view'
import type { RecentFolder, WorkspaceInfo } from './workspace'
import type { StrokeUnder } from './drawing'
import type { Ready } from './ready'
import type { Round, RoundAsk, RoundsView } from './reviews'
import type { NamedSet, NewSet, SetEdit } from './sets'
import type { LineupPair } from './lineup'
import type { LayerColour, LayerShape, PlaneSnap, Tracing, TracingCut, TracingPictureRequest, TracingPictureResult, TracingsFile } from './tracings'
import type { MainAxis } from './planes'
import type { Material, Printer, Profile, Profiles } from './profile'

/** What the onboarding page asks for when the person presses "Create": the new object and everything they gave. */
export interface CreateRequest {
  name: string
  description: string
  /** Files on the disk (from a drop or main's dialog): copied into `reference/` as `photo-<n>.<ext>`. */
  photos: Array<{ path: string; note: string }>
  /** PNG bytes of a drawing: `reference/doodle-<n>.png`. `over` is the index into `photos` of the photo it is drawn over. */
  doodles: Array<{ png: Uint8Array; note: string; over?: number; /** The photo it was drawn over is no longer among the photos: the picture still has it under the ink, and the card says "drawn over a photo". */ onPhoto?: true }>
  /** Vendor STEP files of bought parts (`.step`, `.stp`, at most 50 MB): copied into `reference/` under their own names (`stepFiles`). */
  steps: Array<{ path: string; note: string }>
  /** Not copied: imported into the object after it is made. */
  scans: Array<{ path: string; note: string }>
  /** Other objects of the workspace, by id. */
  objects: Array<{ id: string; note: string }>
  /** What the person measured or read (at most 40): cards of the project's board, never written into `brief.md`. */
  sizes: SizeFact[]
  /** Rules for the model (at most 4000 characters): a text card of the board. */
  rules: string
  /** Links (`http`, `https`; at most 20): a text card each, never opened by torno. */
  links: Array<{ url: string; note: string }>
  /** PDF files (at most 6, 25 MB each, starting `%PDF-`): copied into `reference/` under their own names (`referenceFiles`). */
  pdfs: Array<{ path: string; note: string }>
}

/** A picture the person gave with a note: a PNG or a JPEG, and what they say it is (one line, at most 300 characters). */
export interface NoteReferenceDraft {
  bytes: Uint8Array
  mediaType: 'image/png' | 'image/jpeg'
  comment: string
}

/**
 * A view note as the window sends it to `notes:make`: the picture of the view and the one with the ink on it (PNGs of
 * `size`, at most 2000 px), the strokes and labels in pixels of that picture, what the ink lies over, the comment and the
 * reference pictures. Main checks every field (`main/notes/check.ts`), names and writes every file, and says everything
 * else of the mark: an id, an author, a status or a file name sent here is dropped.
 */
export interface NoteDraft {
  objectId: string
  revision: number
  layout: string
  camera: Camera
  /** The caption of the picture, as `look` made it: checked, but not kept with the mark. */
  caption: string
  size: { w: number; h: number }
  plain: Uint8Array
  inked: Uint8Array
  inkColour: string
  strokes: NoteStroke[]
  labels: NoteLabel[]
  /** One per pen stroke that is told of (at most `MOST_STROKES_TOLD`), then one per label with an arrow. */
  under: StrokeUnder[]
  comment: string
  references: NoteReferenceDraft[]
  /** Where the ink first lies over a face, when it does: main says its tag and how far its part is spread. */
  anchor?: Anchor
  /** What the bar of an open review says of it: want or don't want, none for plain. Main checks it, and keeps it only for a note it makes. */
  intent?: ReviewIntent
}

/** An end of a measure as the window sends it: where it is in the tracing's `[u, v]`, whether it was put on the outline or on the photo, and the point of the outline it says it snapped to. Main checks the snap and works out the rest. */
export interface SpanEndDraft {
  uv: [number, number]
  on: 'tracing' | 'photo'
  snap?: PlaneSnap
}

/** A measure on a tracing as the window sends it to `marks:span`: the tracing, both ends and the view it was made from. Main works out the value, whether it is exact and how it was found. */
export interface SpanDraft {
  tracing: string
  a: SpanEndDraft
  b: SpanEndDraft
  camera: Camera
  note?: string
}

/** A shape of a layer dragged to where it should be, as the window sends it to `marks:offset`: the tracing, the layer's id, the shape's place in the layer and `[du, dv]` in mm along the tracing's axes. Main finds the rest. */
export interface OffsetDraft {
  tracing: string
  layer: number
  shape: number
  by: [number, number]
  camera: Camera
  note?: string
}

/**
 * A 3D sketch as the window sends it to `marks:sketch`. Without `id` it makes the sketch (on the first stroke), with `id`
 * it replaces those fields of the person's sketch. Main checks it against the last build (`main/sketches/check.ts`): each
 * stroke that is new or changed must be of that build and have its snaps bear out; the others are taken from what main
 * kept. An author, a status, a picture, `touches` and what else only main says is dropped.
 */
export interface SketchDraft {
  objectId: string
  id?: string
  layout: string
  /** The build the window showed. */
  revision: number
  camera: Camera
  name: string
  note: string
  take: SketchTake
  diameter?: number
  planes: SketchPlane[]
  /** The strokes the window has: one it had from main names its `id`, and a new one has none. A number is main's to give (`MarkStore.saveSketch`). */
  strokes: NewStroke[]
  anchor?: Anchor
  /** The tracing (`T1`) it is ink on: every plane of it is that tracing's, `from: { kind: 'tracing' }`, and main checks that they are (`checkOnTracing`). */
  tracing?: string
  /** What the bar of an open review said when the sketch was begun: main keeps it of a new sketch of the person's, and never changes it of one it has (`marks:setIntent` does). */
  intent?: ReviewIntent
}

/**
 * What the window changes of a note (`notes:edit`). `inked` is the picture with the new ink on it, and is required
 * when `strokes` or `labels` change. `keepReferences` are the indexes of the references the note has that stay (all
 * of them when it is absent); `addReferences` are new ones.
 */
export interface NoteEdit {
  comment?: string
  labels?: NoteLabel[]
  strokes?: NoteStroke[]
  under?: StrokeUnder[]
  inked?: Uint8Array
  keepReferences?: number[]
  addReferences?: NoteReferenceDraft[]
}

/**
 * What the onboarding page hands main once the object is made and open (`objects.onboard`): the same things it
 * made the object from, for the first prompt. The pictures are the window's, scaled to a long edge of 1280 px (a
 * WebP turned into a PNG or a JPEG): main attaches only a PNG or a JPEG of at most 2000 px, 5 MB.
 */
export interface OnboardDraft {
  description: string
  /** The photos, then the doodles, as `create` named them: `reference/photo-1.jpg`, `reference/doodle-1.png`. The note of a doodle drawn over a photo says so, as `create` writes it on its card (`drawn over reference/photo-2.jpg`, or `drawn over a photo` when that photo is no longer in the draft). */
  items: Array<{ file: string; note: string; image?: Uint8Array }>
  /** The vendor STEP files, as `create` named them: `reference/608zz.step`. */
  steps: Array<{ file: string; note: string }>
  /** The scans to import into the new object, by the path the dialog or the drop gave. */
  scans: Array<{ path: string; note: string }>
  objects: Array<{ id: string; note: string }>
  /** What the person measured or read: told in the prompt in words (`saySize`), as `create` put them on the board. */
  sizes: SizeFact[]
  /** The rules for the model, told in full. */
  rules: string
  /** The links, told one to a line; torno opens none. */
  links: Array<{ url: string; note: string }>
  /** The PDFs, as `create` named them in `reference/` (`referenceFiles`): `reference/datasheet.pdf`. */
  pdfs: Array<{ file: string; note: string }>
  /** The model and effort to start the session on, for it alone; absent, or what is not one: the person's own default. */
  choice?: AgentChoice
}

/** A draft as `objects.previewPrompt` takes it: what the prompt says of it, and no picture data (`picture`: the window holds one fit to attach). */
export interface PromptPreviewDraft {
  description: string
  items: Array<{ file: string; note: string; picture: boolean }>
  steps: Array<{ file: string; note: string }>
  scans: Array<{ path: string; note: string }>
  objects: Array<{ id: string; note: string }>
  sizes: SizeFact[]
  rules: string
  links: Array<{ url: string; note: string }>
  pdfs: Array<{ file: string; note: string }>
}

/** The first prompt of a draft as it would be sent. `attached[i]` is the number of the picture of `items[i]` in it, none when it is named only; `pictured` the same for the objects listed in `objects` (those of the draft that exist). */
export interface PromptPreview {
  text: string
  attached: Array<number | null>
  pictured: Array<number | null>
  objects: string[]
}

/** What came of `objects.onboard`. The object is made and open whatever it says. */
export interface Onboarded {
  /** The chat session started in the object; null when it could not be (then `problem` says why). */
  sessionId: string | null
  /** The text of the first prompt as it was (or would have been) sent, with its pictures. */
  prompt: string
  /** The same text for the composer to hold when the prompt was not sent: it does not say that pictures are attached. */
  held: string
  /** Why the prompt was not sent: the agent could not be started, or has no chat. */
  problem?: string
}

export interface TornoBridge {
  /** The person's home folder, to write `~` for in paths the chat shows; empty when unknown. */
  home: string
  workspace: {
    current(): Promise<WorkspaceInfo | null>
    pick(): Promise<WorkspaceInfo | null>            // folder dialog
    open(root: string): Promise<WorkspaceInfo>
    versions(): Promise<Record<string, string>>     // of the kernel, once it is ready: build123d, python
    /** The folders opened lately, the newest first, eight at most: kept in torno's own config file, never in a workspace. */
    recent(): Promise<RecentFolder[]>
    /** Takes one off that list; answers with the list. */
    forget(root: string): Promise<RecentFolder[]>
    /** Whether this torno has an example to open: it has when it runs from its repository. */
    hasExample(): Promise<boolean>
    /** Opens a copy of the example, made in a temporary folder. It is not remembered. */
    openExample(): Promise<WorkspaceInfo>
    /**
     * "Keep this as a folder": copies the open example, with whatever was made in it, to a new folder at a path the person
     * chooses in the save dialog (never one given here), whole or not at all, and opens that folder in its place. Null
     * when the dialog was cancelled. Rejects, saying why, for a folder that is there already.
     */
    keepExample(): Promise<WorkspaceInfo | null>
    onRequested(cb: (root: string) => void): () => void  // a second launch of torno was given this folder to open
    /** The window was asked to close (the window manager's close): it is held until the window answers. */
    onCloseAsked(cb: () => void): () => void
    /** The answer: `true` closes the window, and torno with it; `false` says the person is being asked, and it stays. */
    answerClose(close: boolean): void
  }
  /**
   * The window has no native frame. Where the platform draws no controls over the bar (Linux) the window draws the three
   * itself (`drawsControls`) and asks main through these.
   */
  window: {
    minimize(): void
    toggleMaximize(): void
    /** The window manager's close: it goes through the question `onCloseAsked` carries, as a click on the frame did. */
    close(): void
    /** True where the window has to draw the three buttons: where the platform gives none. */
    drawsControls(): boolean
    /** The window was maximised (true) or put back (false), also once when it has loaded; returns how to stop listening. */
    onMaximized(fn: (max: boolean) => void): () => void
  }
  /** What torno needs before anything runs (Claude Code, uv, the kernel's Python environment), found before it fails. */
  ready: {
    /** As it stands; `fresh` asks the CLI and looks on the PATH again (the CLI is otherwise asked once per run, and never under test). */
    check(fresh?: boolean): Promise<Ready>
    /** Makes torno's own Python environment (never a workspace's) with uv; progress comes as `onChanged`. Rejects with why not. */
    make(): Promise<void>
    onChanged(cb: (ready: Ready) => void): () => void
  }
  object: {
    open(id: string): Promise<BuildState>            // starts watching and building
    rebuild(id: string): Promise<void>
    /**
     * Try `value` for a field of the model's `Params` in place of the file's default (kept in `.torno/params.json`;
     * the model is never written) and build again. Rejects, saying why, for a field the model does not offer.
     */
    setParam(id: string, name: string, value: number | boolean | string): Promise<void>
    /** Back to the file's values: one field's override, or all of them; builds again. */
    resetParams(id: string, name?: string): Promise<void>
    loadSceneFile(id: string): Promise<SceneFile>    // <object>/.torno/scene.json, defaults when there is none
    saveSceneFile(id: string, file: SceneFile): void
    onBuild(cb: (s: BuildState) => void): () => void
    onScene(cb: (m: { objectId: string; revision: number; scene: Scene; blob: ArrayBuffer }) => void): () => void
  }
  view: {
    report(v: ViewState): void
    onLook(cb: (m: { id: number; request: LookRequest }) => void): () => void
    lookReply(id: number, result: LookResult | { error: string }): void
    /** The agent asks to change what the person sees, or to point something out: each is answered with what was done, or why not. */
    onShow(cb: (m: { id: number; request: ShowRequest }) => void): () => void
    showReply(id: number, result: ShowResult | { error: string }): void
    onHighlight(cb: (m: { id: number; request: HighlightRequest }) => void): () => void
    highlightReply(id: number, result: HighlightResult | { error: string }): void
    /** The agent asked for what a plane cuts: main has the outlines from the kernel, and the window draws them. */
    onDrawSection(cb: (m: { id: number; request: SectionDrawingRequest }) => void): () => void
    drawSectionReply(id: number, result: SectionDrawingResult | { error: string }): void
    /** The agent asked for a picture of a tracing: main has the outline from the kernel and the layers, and the window draws them. */
    onTracingPicture(cb: (m: { id: number; request: TracingPictureRequest }) => void): () => void
    tracingPictureReply(id: number, result: TracingPictureResult | { error: string }): void
    /** The agent proposes a view: the window keeps it among the saved views of the object it shows, marked as proposed, and says what it kept. */
    onSaveView(cb: (m: { id: number; request: SaveViewRequest }) => void): () => void
    saveViewReply(id: number, result: SaveViewResult | { error: string }): void
  }
  /** What the agent asks the person to choose (`ask`): the questions open now, each told again when the list changes, and the answer to one. */
  asks: {
    list(): Promise<OpenAsk[]>
    onChanged(cb: (asks: OpenAsk[]) => void): () => void
    answer(id: number, answer: AskAnswer): void
  }
  /** The marks of an object, kept by main in <object>/.torno/marks.json. Calls reject with a plain message. */
  marks: {
    list(objectId: string): Promise<Mark[]>
    /** A dimension is measured by main as it is kept, and comes back with its value; one the kernel cannot measure is not kept, and the rejection says why. */
    add(objectId: string, mark: NewMark): Promise<Mark>
    /** Keeps what was painted on a scan as a region mark: main works out its count, area and place from the mesh, and writes its triangles beside it. Rejects for no triangle, or bits that are not of that scan's mesh. */
    addRegion(objectId: string, region: NewRegion): Promise<Mark>
    /** A kept region painted again: the same mark and note, of these triangles (the bits of a mask). One the agent was sent is a draft again. */
    repaintRegion(objectId: string, id: string, bits: Uint8Array): Promise<Mark>
    update(objectId: string, id: string, patch: MarkPatch): Promise<Mark>
    /** The person has seen what the agent did with these marks: all are acknowledged in one write, or none, and the rejection says which was not the agent's to acknowledge. */
    acknowledge(objectId: string, ids: string[]): Promise<Mark[]>
    remove(objectId: string, id: string): Promise<void>
    /** Puts back the mark deleted last, whole and with its number, in one change. Only that one, and once. */
    restore(objectId: string, id: string): Promise<Mark>
    /** Puts a pin, a pick or an arrow somewhere else on a part: the same mark and note, tied where it was clicked. An arrow keeps its length and direction. */
    replace(objectId: string, id: string, placed: Replacement): Promise<Mark>
    /**
     * Keeps a sketch the person drew: made when the draft has no `id` (on its first stroke), else the person's sketch of that
     * id with what the draft says. Main checks it against the last build, and answers the sketch as it keeps it (a snapped
     * point is the kernel's, what each stroke touches is main's). Rejects, keeping nothing, with why not.
     */
    sketch(draft: SketchDraft): Promise<Mark>
    /**
     * Keeps a measure on a tracing: main takes the points of a snapped end from the kernel's own (refusing one more than 0.01 mm
     * off), works out the value, whether it is exact (both ends snapped on the outline) and how it was found, and answers the mark.
     * It carries no review intent and is never measured again.
     */
    span(objectId: string, draft: SpanDraft): Promise<Mark>
    /**
     * Keeps "should be here": the shape of the layer dragged by `by`. Main finds the shape as it is (kept as `was`), the layer's
     * revision and the reference point before and after. Dragging the same shape again changes the person's draft. No review intent.
     */
    offset(objectId: string, draft: OffsetDraft): Promise<Mark>
    /** The picture of a sketch's card, drawn by the window: a PNG, kept by main under a name of its own. */
    sketchPicture(objectId: string, id: string, png: Uint8Array): Promise<void>
    /** Which sketch of the object is open for editing now, or none: it is held back from prompts until it is closed. */
    sketching(objectId: string, id: string | null): void
    /**
     * Asks one thing of the rounds of a review and answers them as they are then. A round is started on the build on show,
     * which main finds in the history and stars (it is never the window's word); it is refused while a build is running or
     * has failed. Rejects, changing nothing, with why not.
     */
    round(objectId: string, ask: RoundAsk): Promise<RoundsView>
    /** The rounds of a project and which is being sent. */
    rounds(objectId: string): Promise<RoundsView>
    /** Says what the person wants (`want`), does not want (`dont`) or says nothing of (`null`) of a mark of theirs. It does not put the mark in a round. */
    setIntent(objectId: string, id: string, intent: 'want' | 'dont' | null): Promise<Mark>
    /** Takes a mark out of its round. */
    roundOut(objectId: string, id: string): Promise<Mark>
    /** The person's verdict on an item of a round the agent resolved, on the build on show; Still wrong carries it into the next round. */
    judge(objectId: string, id: string, verdict: 'ok' | 'still-wrong', note?: string): Promise<Mark>
    onChanged(cb: (m: { objectId: string; marks: Mark[]; rounds: Round[]; sending: string | null }) => void): () => void
    /** Something about an object's marks file the person should know, said once: a file that could not be read was set aside. */
    onProblem(cb: (m: { objectId: string; message: string }) => void): () => void
    /** What `onProblem` last said of an object, for a window that was not listening then; null when nothing, or once dismissed. */
    problem(objectId: string): Promise<string | null>
    dismissProblem(objectId: string): Promise<void>
  }
  /**
   * The named sets of a project, kept by main in <project>/.torno/sets.json: faces, edges, parts and sketch strokes under a
   * name. The window names a project and a set (`N<n>`); everything else of a set (who made it, whether it is proposed, what
   * is lost, each face's selector) is main's. A set the window makes is the person's. Calls reject with a plain message.
   */
  sets: {
    list(objectId: string): Promise<NamedSet[]>
    /**
     * Makes a set at once, from refs with the point and normal the person pointed at (and strokes as `M7/k3`); main then finds each
     * face's selector and writes it. `revision` is the build the window shows, which the refs are of: when it is not the last, main
     * has the set found again against the last build.
     */
    make(objectId: string, ask: NewSet, revision?: number): Promise<NamedSet>
    /** Renames, recolours, comments, adds, takes away and re-picks lost members (`revision` as for `make`). Rejects, changing nothing, with why not. */
    edit(objectId: string, id: string, edit: SetEdit, revision?: number): Promise<NamedSet>
    remove(objectId: string, id: string): Promise<void>
    /** Puts back the set deleted last, whole and with its number, once. */
    restore(objectId: string, id: string): Promise<NamedSet>
    /** Accepts the agent's proposal: it becomes the person's. Rejects for a set that is not proposed. */
    accept(objectId: string, id: string): Promise<NamedSet>
    /** Turns the agent's proposal down: the set is deleted. Rejects for a set that is not proposed. */
    dismiss(objectId: string, id: string): Promise<void>
    /** The sets of a project, whole, as they now are, whoever changed them. */
    onChanged(cb: (m: { objectId: string; sets: NamedSet[] }) => void): () => void
    /** Something about a project's sets file the person should know, said once: a file that could not be read was set aside. */
    onProblem(cb: (m: { objectId: string; message: string }) => void): () => void
    /** What `onProblem` last said of a project, for a window that was not listening then; null when nothing, or once dismissed. */
    problem(objectId: string): Promise<string | null>
    dismissProblem(objectId: string): Promise<void>
  }
  /**
   * The tracings of a project (`<project>/.torno/tracings.json`): the model laid flat in one plane at true scale. Main is their
   * only writer and never takes an id, an author, a layer's id or author or anything it works out from the window: the window names
   * a project, a tracing (`T<n>`) and a layer (its number), and what it says is checked. What the window makes is the person's.
   * Calls reject with a plain message.
   */
  tracings: {
    /** The file, whole: the number the next is given, and the tracings. */
    list(objectId: string): Promise<TracingsFile>
    /**
     * Makes a tracing on a main plane (`main` with its `offset`), on a planar face (`face`: `block/F12`, or a tag of one face) or
     * on the section on screen (`section: true`), of a layout and, optionally, some of its parts. Main makes the plane's frame; a
     * face that is not planar, or no section on screen, is refused in words.
     */
    make(objectId: string, ask: { on: { main: MainAxis; offset?: number } | { face: string } | { section: true }; name?: string; layout: string; parts?: string[] }): Promise<Tracing>
    /** Renames a tracing, or changes the parts it draws (`null` for all of them). */
    edit(objectId: string, id: string, patch: { name?: string; parts?: string[] | null }): Promise<Tracing>
    /** Removes a tracing, the agent's too. */
    remove(objectId: string, id: string): Promise<void>
    /** Puts back the tracing removed in this run, whole and with its number, once. */
    restore(objectId: string, id: string): Promise<Tracing>
    /** The person's change to a layer: a new one, changes to their own, taking one away, putting one back that was removed in this run (with its number), or hiding any layer. Answers the tracing. */
    layer(
      objectId: string,
      id: string,
      change: { make: { name: string; colour: LayerColour; shapes: LayerShape[] } } | { edit: number; name?: string; colour?: LayerColour; shapes?: LayerShape[] } | { remove: number } | { restore: number } | { hide: number; hidden: boolean }
    ): Promise<Tracing>
    /** The outline of a tracing on the last good build (the kernel's cut, with the points it can be snapped to), or null when there is none to be had. */
    outline(objectId: string, id: string): Promise<TracingCut | null>
    /** Which tracings the window shows now (the view, the visible board cards, Show in 3D): those are cut again after every build. */
    shown(objectId: string, ids: string[]): void
    /** The file, whole, as it now is, whoever changed it. */
    onChanged(cb: (m: { objectId: string; file: TracingsFile }) => void): () => void
    /** A shown tracing cut again on a new build. */
    onOutline(cb: (m: { objectId: string; cut: TracingCut }) => void): () => void
    /** Something about a project's tracings file the person should know, said once: a file that could not be read was set aside. */
    onProblem(cb: (m: { objectId: string; message: string }) => void): () => void
    /** What `onProblem` last said of a project, for a window that was not listening then; null when nothing, or once dismissed. */
    problem(objectId: string): Promise<string | null>
    dismissProblem(objectId: string): Promise<void>
    /**
     * Keeps a photo for a tracing: its PNG or JPEG bytes (a long edge of at most 4000 px and 25 MB, the EXIF turn already applied) and, if it was taken from the
     * project's references, `reference/<file>`. Main checks, names and hashes the file. A photo already there is swapped: the tracing side of its pairs stays, the
     * photo side and the line-up go. Rejects with a plain message for anything that is not such a picture.
     */
    photo(objectId: string, id: string, bytes: Uint8Array, from?: string): Promise<Tracing>
    /**
     * Lines the photo up: 2 to 8 pairs, each a point of the photo (px of the kept file), a point of the tracing (`uv`, mm) and, if it was snapped, what to
     * (`{ corner: [u, v] }`, `{ centre: edgeRef | [u, v] }`, `{ vertex: ref }`: main replaces the point by the kernel's and refuses one more than 0.01 mm off),
     * and a method: `similar` (2 points or more) or `straight` (4 or more, a homography). Main works out the transform, scale, angle and fit itself; nothing
     * else the window says is taken. Nothing of it is exact.
     */
    lineUp(objectId: string, id: string, pairs: LineupPair[], method: 'similar' | 'straight'): Promise<Tracing>
    /** The person's look of a photo: its fade (0 to 1) and whether it is hidden. It travels with the tracing. */
    look(objectId: string, id: string, look: { fade?: number; hidden?: boolean }): Promise<Tracing>
    /**
     * Keeps the copy of the photo the window warped through the line-up (PNG or JPEG, at most 4000 px), for the photo (`sha256`) and the matrix
     * (`transformKey` of its `transform`) it was made from. Refused when either is not the tracing's now.
     */
    straightened(objectId: string, id: string, bytes: Uint8Array, of: { sha256: string; transform: string }): Promise<Tracing>
    /** The bytes of a tracing's photo or its straightened copy; null when the file is not on this computer, or is another file than the tracing names. */
    photoBytes(objectId: string, id: string, which: 'photo' | 'straightened'): Promise<Uint8Array | null>
    /** Takes the photo off a tracing, with its line-up. */
    removePhoto(objectId: string, id: string): Promise<Tracing>
  }
  /** The view notes of a project (`<project>/.torno/notes/`): main checks what is sent, names and writes the pictures, and says the rest of the mark. Calls reject with a plain message. */
  notes: {
    /** Keeps a new note, as a draft: its pictures are written, then the mark. */
    make(draft: NoteDraft): Promise<Mark>
    /** Changes a note. A new inked picture is a new file: the old one stays until the sweep when the project is next opened. */
    edit(objectId: string, id: string, patch: NoteEdit): Promise<Mark>
    /** The bytes of a note's picture with the ink on it, the plain one or the reference at that index; of a 3D sketch, the picture of its card (`ink` or `plain`). Null when the file is not on this computer. */
    picture(objectId: string, id: string, which: 'ink' | 'plain' | number): Promise<Uint8Array | null>
  }
  /** Making a new object by onboarding. Calls reject with a plain message. */
  /** The board of a project (`<project>/.torno/board/`): main is its only writer, and it never takes an id, an author or `hidden` from the window. */
  board: {
    read(objectId: string): Promise<BoardFile>
    /** A change the person made. Answers with the board as it now is; rejects, changing nothing, with why not. A card the window adds is the person's whatever it says. */
    change(objectId: string, change: PersonChange): Promise<BoardFile>
    /** The bytes of a picture or sketch of the board; null when there is none of that name. */
    picture(objectId: string, name: string): Promise<Uint8Array | null>
    /** The text of the project's `brief.md`, as far as a card shows it; null when there is none. */
    brief(objectId: string): Promise<string | null>
    /** A photo or doodle of `reference/` by the name its card has (`reference/photo-1.jpg`); null for any other file. */
    reference(objectId: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null>
    /** Keeps a PNG or JPEG the person gave (at most 3.75 MB and 2000 px) and answers with the name a card is to hold. Rejects for anything else. */
    addPicture(objectId: string, bytes: Uint8Array): Promise<string>
    /** Pins a build of the history, a saved view, the Params or the checks. Answers with the board, or why it was not pinned. */
    pin(objectId: string, what: PinWhat): Promise<BoardFile | { refused: string }>
    /** Opens the project's `brief.md` in the person's own program, or shows a file of its `reference/` in its folder. Rejects with why not. */
    open(objectId: string, what: BoardOpen): Promise<void>
    /** Opens the first `http` or `https` link of a text card in the person's browser. Main reads the card; rejects with why not (no such card, no link). */
    openLink(objectId: string, cardId: string): Promise<void>
    /** The board of a project changed, whoever changed it: the whole board as it now is. */
    onChanged(cb: (m: { objectId: string; board: BoardFile }) => void): () => void
    /** What main found wrong with a project's board file (not readable, cards left out, not a plain file): told once as it happens. */
    onProblem(cb: (m: { objectId: string; message: string }) => void): () => void
    /** What `onProblem` last said of a project, for a window that was not listening then; null when nothing, or once dismissed. */
    problem(objectId: string): Promise<string | null>
    dismissProblem(objectId: string): Promise<void>
  }
  objects: {
    /** The photo dialog (several images); under test, what `__tornoMain.pickPhotos` holds. [] when cancelled. */
    pickPhotos(): Promise<string[]>
    /** The scan dialog (`scans.pick`). */
    pickScan(): Promise<string | null>
    /** The dialog for a vendor STEP file (`.step`, `.stp`); under test, what `__tornoMain.pickStep` holds. null when cancelled. */
    pickStep(): Promise<string | null>
    /** The dialog for a PDF; under test, what `__tornoMain.pickPdf` holds. null when cancelled. */
    pickPdf(): Promise<string | null>
    /** Where a file dropped on the window is on the disk (`webUtils.getPathForFile`); '' for one that is nowhere. */
    pathOf(file: File): string
    /** The bytes of an image file the dialog or a drop gave (a plain PNG, JPEG or WebP file of at most 25 MB), to draw it and scale a copy for the prompt. */
    readPhoto(path: string): Promise<Uint8Array>
    /** Makes the folder of a new object, whole or not at all, and answers with its id once the workspace lists it. */
    create(req: CreateRequest): Promise<{ objectId: string }>
    /**
     * Imports the draft's scans into the object, starts its chat session and sends the first prompt (text and up to 6
     * pictures). Rejects for an object that is not of the open workspace or that has a session already. A session that
     * cannot be started is not a rejection: `sessionId` is null and the prompt comes back to be held.
     */
    onboard(objectId: string, draft: OnboardDraft): Promise<Onboarded>
    /** The first prompt `onboard` would send for this draft, with the project named `name`; writes and starts nothing. */
    previewPrompt(name: string, draft: PromptPreviewDraft): Promise<PromptPreview>
    /** Every name in the open workspace's folder (folders and files, hidden ones too), for the page to check a new name against as main does. */
    taken(): Promise<string[]>
  }
  /** The scans of an object, kept by main in <object>/.torno/scans.json and .torno/scans/. Calls reject with a plain message. */
  scans: {
    list(objectId: string): Promise<ScanInfo[]>
    /** The file dialog; under test, what `__tornoMain.pickFile` holds. Null when nothing was chosen. */
    pick(): Promise<string | null>
    /** Where a file dropped on the window is on the disk (`webUtils.getPathForFile`); '' for one that is nowhere. */
    pathOf(file: File): string
    /** Has the file read by the import process, which takes seconds: `onProgress` says where it stands. The file itself is never changed. */
    import(objectId: string, path: string): Promise<ScanInfo>
    /** Reads the scan's source again into the same scan: its id, its name and its alignments stay. Rejects when the source is missing. Told by `onProgress` as an import is. */
    reimport(objectId: string, id: string): Promise<Reimported>
    /** The scan as if its source had been read with this unit and up axis. Its alignments are dropped when either changes. */
    convert(objectId: string, id: string, as: { unit: ScanUnit; up: ScanUp }): Promise<ScanInfo>
    rename(objectId: string, id: string, name: string): Promise<ScanInfo>
    remove(objectId: string, id: string): Promise<void>
    /**
     * Where the scan is in a layout of the last build, or null for nowhere. `made` says which build it was fitted
     * on (main refuses another than the last) and what the person said yes to: an alignment that is rough, or
     * that changes the scan's size, is kept only with that yes. Main adds how that build's parts are spread, when,
     * the residuals and why it is rough.
     */
    align(objectId: string, id: string, layout: string, alignment: NewAlignment, made: AlignMade): Promise<ScanInfo>
    /** With null: the scan is aligned to nothing in that layout any more. */
    align(objectId: string, id: string, layout: string, alignment: null): Promise<ScanInfo>
    /** Puts back the alignment the scan had in that layout before the last one was kept. Rejects when there is none to go back to. */
    undoAlign(objectId: string, id: string, layout: string): Promise<ScanInfo>
    /**
     * The person looked and says the alignment still holds, whatever put it in doubt. Main asks the kernel where the
     * model points it is tied to are now, and holds later builds against that; rejects when the kernel cannot say.
     */
    alignHolds(objectId: string, id: string, layout: string): Promise<ScanInfo>
    /** The scan's `mesh.bin`, for `parseScanMesh`. */
    mesh(objectId: string, id: string): Promise<ArrayBuffer>
    /** The `.mask` of a region of a scan, as the file is, by its stem (`maskStem`): for `maskBits`. */
    mask(objectId: string, id: string, stem: string): Promise<ArrayBuffer>
    onChanged(cb: (m: { objectId: string; scans: ScanInfo[] }) => void): () => void
    onProgress(cb: (m: { objectId: string; name: string; stage: string | null }) => void): () => void
    /** Something about an object's scans file the person should know, said once: a file that could not be read was set aside. */
    onProblem(cb: (m: { objectId: string; message: string }) => void): () => void
    /** What `onProblem` last said of an object, for a window that was not listening then; null when nothing, or once dismissed. */
    problem(objectId: string): Promise<string | null>
    dismissProblem(objectId: string): Promise<void>
  }
  geometry: {
    describe(objectId: string, layout: string, ref: string): Promise<Described>   // rejects with a plain message
    measure(objectId: string, probe: MeasureProbe): Promise<MeasuredOnce>   // the kernel's value of a measurement not kept; writes nothing; rejects with a plain message
  }
  /** The page of objects: a card for each object of the workspace, read from what main knows and from what is on file. Asking builds nothing. */
  show: {
    cards(): Promise<ObjectCard[]>
    /** The PNG on file, or null. */
    thumbnail(objectId: string): Promise<ArrayBuffer | null>
    /** A picture of the build `revision` of an object opened in this run. Dropped without a word when that is no longer its last build, or the bytes are no such picture. */
    saveThumbnail(objectId: string, revision: number, png: Uint8Array, of: ThumbnailOf): void
    /** Something a card says may have changed. */
    onChanged(cb: () => void): () => void
  }
  /** The builds kept of an object under its `.torno/history/` (`main/history.ts`). The window reads them, stars them and asks for a Go back; only main writes the files (`main/goback.ts`). */
  history: {
    /** Oldest first; null for an object that is not of the open workspace. */
    list(objectId: string): Promise<HistoryList | null>
    /** The PNG kept with a build, or null. */
    thumbnail(objectId: string, id: string): Promise<ArrayBuffer | null>
    /** The text of one copied source file of a build (`file` is one of its `files`), or null. */
    source(objectId: string, id: string, file: string): Promise<string | null>
    /** A build made in this run, with its meshes, to be drawn over the current one for display only; its `refused` sentence when it cannot be drawn (it failed, or its copy is not kept or no longer builds); null for a project main does not know. See `HistoryList.ghosts`: those are held, the rest are built again. */
    ghost(objectId: string, id: string): Promise<HistoryGhost | null>
    /** Stars a build, or takes the star away: a starred build is not let go. False for a build that is not kept. */
    star(objectId: string, id: string, starred: boolean): Promise<boolean>
    /**
     * What "Go back to before this prompt" would do (`prompt` is a turn's prompt id, as the history names it), to be shown
     * before anything is written; or a sentence on why it cannot. Reads only. A plan with `fallback: 'undo'` has no copy
     * to restore: the chat's Undo is the way back then.
     */
    goBackPlan(objectId: string, prompt: string): Promise<GoBackPlan | { refused: string }>
    /**
     * Goes back, once the person has confirmed what `goBackPlan` showed (`confirmed` is only what they were shown: main works
     * the plan out again and does nothing if it is not the same). Resolves with what was written and removed, and the first
     * thing that failed; `refused` when nothing was touched. The files written are the project's own `.py` files, never
     * `common/` or another project.
     */
    goBack(objectId: string, prompt: string, confirmed: Pick<GoBackPlan, 'to' | 'write' | 'remove'>): Promise<GoBackResult>
    /** Told, with the object, when its history changed. */
    onChanged(cb: (objectId: string) => void): () => void
  }
  /** What git says of an object's sources, read and never written; null where there is no git, no repository, or no answer in time. */
  git: {
    status(objectId: string): Promise<GitState | null>
  }
  /** One HTML file of an object or of several, that opens by itself, or a STEP, STL or 3MF file of one: see `main/export`. Calls reject with a plain message. */
  export: {
    /** What a file of this request would hold and weigh, with every object of the workspace and whether it can be exported. Writes nothing. */
    plan(req: ExportRequest): Promise<ExportPlan>
    /** Asks where to save (under test: `__tornoMain.pickSave`), writes the file there, and says where; of a file of the model, what its check found. Null when the dialog was cancelled. The path is the dialog's alone: the window never names one. */
    save(req: ExportRequest): Promise<ExportSaved | null>
    /** Keeps a picture of the view the window drew (a PNG, up to 4000 px on its long edge): asks where to save (under test: `__tornoMain.pickSave`) and writes it there. Null when the dialog was cancelled. The path is the dialog's alone. */
    savePicture(objectId: string, png: Uint8Array): Promise<ExportSaved | null>
    /** Keeps a drawing (an SVG, or a PDF made of it, at true scale, with a scale bar and a title block) of the section on screen: main asks the kernel for the outlines, asks where to save and writes it there. Null when the dialog was cancelled. Rejects when there is no section on screen. The path is the dialog's alone. */
    saveSection(objectId: string, as: 'svg' | 'pdf'): Promise<ExportSaved | null>
    /** Keeps a drawing (an SVG, or a PDF made of it, at true scale) of one of the project's tracings, `T1`: the outline of its plane, and as ticked its layers, the marks on it and its photo. Main cuts it of the last good build, asks where to save and writes it there. Null when the dialog was cancelled. Rejects when the tracing is not there or a build landed meanwhile. The window names ids and ticks, never a path or bytes. */
    saveTracing(objectId: string, tracingId: string, as: 'svg' | 'pdf', ticks: { layers: boolean; marks: boolean; photo: boolean }): Promise<ExportSaved | null>
    /** Shows the file this sheet saved last in its folder. It takes no path: main keeps the one it wrote. Rejects when the file is gone. */
    reveal(): Promise<void>
    /** Has the system open the file this sheet saved last (a page, in the browser). No path either. */
    openSaved(): Promise<void>
    /** The export sheet was put away: what main kept ready for it (scans reduced) is let go. */
    done(): void
  }
  session: {
    /**
     * What there is for an object: its running session; the view its next session starts in (the one chosen for it)
     * and whether a conversation can be resumed. `note` says so when the object's `agent.json` could not be followed.
     */
    current(objectId: string): Promise<{ running: { sessionId: string; status: SessionStatus; view: AgentView } | null; /** A chat that has ended and whose conversation main still holds: a window loaded after it ended can read it. Absent while one runs. */ ended?: { sessionId: string }; resumable: boolean; view: AgentView; note?: string }>
    /**
     * Starts Claude Code in the object's folder, at the terminal's size; returns the session already running there, if any. Either way with its status as it is then.
     * `skills: false` starts it on the whole system prompt and without torno's plugin of skills (what the person asks for when the chat said the skills did not load).
     */
    start(objectId: string, opts?: { resume?: boolean; cols?: number; rows?: number; skills?: false }): Promise<{ sessionId: string; cols: number; rows: number; status: SessionStatus; view: AgentView }>
    /** The person said to start the chat in the object's folder though it has Claude Code settings of its own (the question `start` refused with): remembered in torno's own data, for the real path of the folder. */
    trust(objectId: string): Promise<void>
    /** The instruction files Claude Code reads by default for the object (its folder, every folder above it, the person's own): paths and sizes, never their text. Main keeps the list its rows are numbered by. */
    instructions(objectId: string): Promise<InstructionFile[]>
    /** Shows the file at that place of the list last given for the object in its folder. Never opens or runs it; rejects when the place is not in the list. */
    revealInstruction(objectId: string, index: number): Promise<void>
    /** Keeps the view (`chat` or `terminal`) of an object's sessions to come in its `.torno/agent.json`. Rejects while a session runs there. */
    chooseView(objectId: string, view: AgentView): Promise<void>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    stop(sessionId: string): Promise<void>
    onData(cb: (m: { sessionId: string; data: string }) => void): () => void
    onStatus(cb: (m: { sessionId: string; status: SessionStatus }) => void): () => void
    insert(sessionId: string, text: string): void     // bracketed paste at the cursor, never submitted
  }
  /**
   * The conversation of a chat session (`AgentView` `chat`): main keeps it, the window draws it. Calls for a session
   * that is not of the open workspace are refused, and so are all but `history` for one that has ended. Calls reject with a plain message.
   */
  chat: {
    /** Everything the window needs to draw a session, whenever it asks; readable also after the session has ended, until another starts in that object. */
    history(sessionId: string): Promise<ChatHistory>
    /** The end of the conversation an object's next session would resume (its last turns, text only, and when its log was last written; `at` null when it has no log, as one begun in a terminal), or null when there is none. Read from `.torno/chat/`; nothing is made. */
    lastConversation(objectId: string): Promise<{ items: ChatItem[]; at: string | null } | null>
    /** Every prompt of the object's conversations that was sent, oldest first, numbered from 1 across all of them (a terminal's from the history): what "Prompts only" lists. Read from `.torno/chat/`. */
    prompts(objectId: string): Promise<PromptRow[]>
    /** The items of one earlier conversation of the object, from its log (its last 500), for reading above the current one; none for a conversation with no log. Read only. */
    conversation(objectId: string, conversationId: string): Promise<ChatItem[]>
    /** The bytes of a picture of the person's in the session's object, `reference/photo-1.jpg` (`ChatImage.file`), read again by main: none for a file that is not a plain file of a name torno gives there, or for a session that is not of the open workspace. Also for a session that has ended. */
    reference(sessionId: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null>
    /**
     * What a turn changed in the `.py` files directly in the project's folder, by the id of the turn's item: the text of
     * each file that differs, as it was when the prompt was sent and when the turn ended. Held by main in memory for the
     * last turns of the session only (never written, never in the chat's log): null for a turn it holds none of, which
     * is also one that changed no file there, and for a session that is not of the open workspace.
     */
    changes(sessionId: string, turnId: string): Promise<TurnChanges | null>
    /**
     * "Undo" on the last turn: asks the agent, in a prompt torno writes, to put the model files back as they were before
     * that turn (the lines to reverse come from `changes`). Torno writes nothing of the model; the agent edits through
     * its permission cards. Rejects, sending nothing, when the session is not idle, the turn is not the last or main holds nothing of it.
     */
    undo(sessionId: string, turnId: string): Promise<void>
    /** An item of the transcript was added or changed. One whose `seq` is not above the `seq` of the history asked for before holds nothing the history does not. */
    onItem(cb: (m: { sessionId: string; item: ChatItem; seq: number }) => void): () => void
    onMeta(cb: (m: { sessionId: string; meta: ChatMeta; seq: number }) => void): () => void
    /** The slash commands and models the session's CLI has, told when it has said them (a history had earlier may lack them). */
    onCapabilities(cb: (m: { sessionId: string; commands: ChatCommand[]; models: ChatModel[]; seq: number }) => void): () => void
    /**
     * Sends a prompt; with `attachedView`, main adds that picture (the one "Attach view" showed, checked as any picture for the agent) and no other; with `attachView` alone, a picture of the viewport as it is now; with `board`, the cards and frames it names (or all
     * the board), read as they are now and told in text with up to six of their pictures. The project's draft view notes (`notes.make`)
     * go with it of themselves, in the order of the marks, within the 6 pictures a prompt carries. Rejects, sending nothing, when a picture cannot be
     * made or the board cannot be read.
     */
    send(sessionId: string, prompt: { text: string; attachView?: boolean; attachedView?: Uint8Array; board?: BoardAttach }): Promise<void>
    /** Answers a request of the agent's. The tool runs with the input it asked with; only the answers of `AskUserQuestion` are taken from the window. */
    answer(sessionId: string, requestId: string, answer: ChatAnswer): void
    interrupt(sessionId: string): Promise<void>
    /** For this session only: the person's settings are not written. */
    setModel(sessionId: string, model: string): Promise<void>
    /** For the session alone too (`apply_flag_settings`): the person's settings are not written. Rejects for an effort the CLI does not take. */
    setMode(sessionId: string, mode: Mode): Promise<void>
    setEffort(sessionId: string, effort: Effort): Promise<void>
    /** The models a session can be started on before it has said its own: the list the last chat's CLI offered, or Claude Code's aliases. */
    models(): Promise<ChatModel[]>
  }
  /** The printer and material a project is made for (`<project>/.torno/profile.json`), and the person's own to choose from (torno's settings). */
  profile: {
    /** The person's printers, and their materials after the starter ones. */
    choices(): Promise<Profiles>
    /** Keeps a printer (or replaces the one of that name); rejects with why when it is not one. Answers with the choices. */
    savePrinter(printer: Printer): Promise<Profiles>
    saveMaterial(material: Material): Promise<Profiles>
    /** The profile of a project; null when it has none. */
    get(objectId: string): Promise<Profile | null>
    /** Names the printer and material a project is made for (copied into it), or, with neither, takes them off. */
    set(objectId: string, profile: Profile): Promise<Profile | null>
  }
}
/** How Claude Code's session is shown: as a chat torno draws, or as the CLI's own terminal. */
export type AgentView = 'chat' | 'terminal'

export type SessionStatus = 'starting' | 'idle' | 'working' | 'needs_input' | 'exited'
