import type { BuildState } from './build'
import type { ChatAnswer, ChatHistory, ChatCommand, ChatItem, ChatMeta, ChatModel } from './chat'
import type { ExportPlan, ExportRequest } from './exportdata'
import type { Described } from './geometry'
import type { Mark, MarkPatch, NewMark, NewRegion, Replacement } from './marks'
import type { Scene } from './scene'
import type { AlignMade, NewAlignment, Reimported, ScanInfo, ScanUnit, ScanUp } from './scans'
import type { SceneFile } from './scenefile'
import type { ObjectCard, ThumbnailOf } from './show'
import type { HighlightRequest, HighlightResult, LookRequest, LookResult, SaveViewRequest, SaveViewResult, SectionDrawingRequest, SectionDrawingResult, ShowRequest, ShowResult, ViewState } from './view'
import type { RecentFolder, WorkspaceInfo } from './workspace'
import type { ViewDrawing } from './drawing'

/** What the onboarding page asks for when the person presses "Create": the new object and everything they gave. */
export interface CreateRequest {
  name: string
  description: string
  /** Files on the disk (from a drop or main's dialog): copied into `reference/` as `photo-<n>.<ext>`. */
  photos: Array<{ path: string; note: string }>
  /** PNG bytes of a drawing: `reference/doodle-<n>.png`. */
  doodles: Array<{ png: Uint8Array; note: string }>
  /** Not copied: imported into the object after it is made. */
  scans: Array<{ path: string; note: string }>
  /** Other objects of the workspace, by id. */
  objects: Array<{ id: string; note: string }>
}

/**
 * What the onboarding page hands main once the object is made and open (`objects.onboard`): the same things it
 * made the object from, for the first prompt. The pictures are the window's, scaled to a long edge of 1280 px (a
 * WebP turned into a PNG or a JPEG): main attaches only a PNG or a JPEG of at most 2000 px, 5 MB.
 */
export interface OnboardDraft {
  description: string
  /** The photos, then the doodles, as `create` named them: `reference/photo-1.jpg`, `reference/doodle-1.png`. */
  items: Array<{ file: string; note: string; image?: Uint8Array }>
  /** The scans to import into the new object, by the path the dialog or the drop gave. */
  scans: Array<{ path: string; note: string }>
  objects: Array<{ id: string; note: string }>
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
    onRequested(cb: (root: string) => void): () => void  // a second launch of torno was given this folder to open
    /** The window was asked to close (the window manager's close): it is held until the window answers. */
    onCloseAsked(cb: () => void): () => void
    /** The answer: `true` closes the window, and torno with it; `false` says the person is being asked, and it stays. */
    answerClose(close: boolean): void
  }
  object: {
    open(id: string): Promise<BuildState>            // starts watching and building
    rebuild(id: string): Promise<void>
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
    /** The agent proposes a view: the window keeps it among the saved views of the object it shows, marked as proposed, and says what it kept. */
    onSaveView(cb: (m: { id: number; request: SaveViewRequest }) => void): () => void
    saveViewReply(id: number, result: SaveViewResult | { error: string }): void
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
    /** Puts a pin, a pick or an arrow somewhere else on a part: the same mark and note, tied where it was clicked. An arrow keeps its length and direction. */
    replace(objectId: string, id: string, placed: Replacement): Promise<Mark>
    onChanged(cb: (m: { objectId: string; marks: Mark[] }) => void): () => void
    /** Something about an object's marks file the person should know, said once: a file that could not be read was set aside. */
    onProblem(cb: (m: { objectId: string; message: string }) => void): () => void
    /** What `onProblem` last said of an object, for a window that was not listening then; null when nothing, or once dismissed. */
    problem(objectId: string): Promise<string | null>
    dismissProblem(objectId: string): Promise<void>
  }
  /** Making a new object by onboarding. Calls reject with a plain message. */
  objects: {
    /** The photo dialog (several images); under test, what `__tornoMain.pickPhotos` holds. [] when cancelled. */
    pickPhotos(): Promise<string[]>
    /** The scan dialog (`scans.pick`). */
    pickScan(): Promise<string | null>
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
  /** One HTML file of an object or of several, that opens by itself: see `main/export`. Calls reject with a plain message. */
  export: {
    /** What a file of this request would hold and weigh, with every object of the workspace and whether it can be exported. Writes nothing. */
    plan(req: ExportRequest): Promise<ExportPlan>
    /** Asks where to save (under test: `__tornoMain.pickSave`), writes the file there, and says where; null when the dialog was cancelled. The path is the dialog's alone: the window never names one. */
    save(req: ExportRequest): Promise<{ path: string; bytes: number; dropped: string[] } | null>
    /** The export sheet was put away: what main kept ready for it (scans reduced) is let go. */
    done(): void
  }
  session: {
    /**
     * What there is for an object: its running session; the view its next session starts in (the one chosen for it)
     * and whether a conversation can be resumed. `note` says so when the object's `agent.json` could not be followed.
     */
    current(objectId: string): Promise<{ running: { sessionId: string; status: SessionStatus; view: AgentView } | null; /** A chat that has ended and whose conversation main still holds: a window loaded after it ended can read it. Absent while one runs. */ ended?: { sessionId: string }; resumable: boolean; view: AgentView; note?: string }>
    /** Starts Claude Code in the object's folder, at the terminal's size; returns the session already running there, if any. Either way with its status as it is then. */
    start(objectId: string, opts?: { resume?: boolean; cols?: number; rows?: number }): Promise<{ sessionId: string; cols: number; rows: number; status: SessionStatus; view: AgentView }>
    /** The person said to start the chat in the object's folder though it has Claude Code settings of its own (the question `start` refused with): remembered in torno's own data, for the real path of the folder. */
    trust(objectId: string): Promise<void>
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
    /** The bytes of a picture of the person's in the session's object, `reference/photo-1.jpg` (`ChatImage.file`), read again by main: none for a file that is not a plain file of a name torno gives there, or for a session that is not of the open workspace. Also for a session that has ended. */
    reference(sessionId: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null>
    /** An item of the transcript was added or changed. One whose `seq` is not above the `seq` of the history asked for before holds nothing the history does not. */
    onItem(cb: (m: { sessionId: string; item: ChatItem; seq: number }) => void): () => void
    onMeta(cb: (m: { sessionId: string; meta: ChatMeta; seq: number }) => void): () => void
    /** The slash commands and models the session's CLI has, told when it has said them (a history had earlier may lack them). */
    onCapabilities(cb: (m: { sessionId: string; commands: ChatCommand[]; models: ChatModel[]; seq: number }) => void): () => void
    /**
     * Sends a prompt; with `attachView`, main adds a picture of the viewport as the person sees it now; with `drawing`,
     * the person's drawing on the view, after a caption main writes. Rejects, sending nothing, when a picture cannot be
     * made or the drawing is not one.
     */
    send(sessionId: string, prompt: { text: string; attachView?: boolean; drawing?: ViewDrawing }): Promise<void>
    /** Answers a request of the agent's. The tool runs with the input it asked with; only the answers of `AskUserQuestion` are taken from the window. */
    answer(sessionId: string, requestId: string, answer: ChatAnswer): void
    interrupt(sessionId: string): Promise<void>
    /** For this session only: the person's settings are not written. */
    setModel(sessionId: string, model: string): Promise<void>
  }
}
/** How Claude Code's session is shown: as a chat torno draws, or as the CLI's own terminal. */
export type AgentView = 'chat' | 'terminal'

export type SessionStatus = 'starting' | 'idle' | 'working' | 'needs_input' | 'exited'
