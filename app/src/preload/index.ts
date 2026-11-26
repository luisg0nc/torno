import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { TornoBridge } from '../shared/bridge'
import { unrefused } from '../shared/refusal'
import type { AlignMade, NewAlignment } from '../shared/scans'

// Channel names are those listed in src/main/ipc.ts.
function subscribe<T>(channel: string, cb: (message: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, message: T) => cb(message)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

/** An invoke: what main refused (a `Refusal` there) rejects here with its message, as a thrown handler would. */
const invoke = (channel: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(channel, ...args).then(unrefused)

/** An invoke whose rejection carries the message main gave, without what Electron puts before it. */
async function invokePlain<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return unrefused(await ipcRenderer.invoke(channel, ...args))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
  }
}

const bridge: TornoBridge = {
  home: process.env.HOME ?? process.env.USERPROFILE ?? '',
  workspace: {
    current: () => invoke('workspace:current'),
    pick: () => invoke('workspace:pick'),
    open: (root) => invoke('workspace:open', root),
    versions: () => invoke('workspace:versions'),
    refresh: () => invoke('workspace:refresh'),
    recent: () => invoke('workspace:recent'),
    forget: (root) => invoke('workspace:forget', root),
    hasExample: () => invoke('workspace:hasExample'),
    openExample: () => invoke('workspace:openExample'),
    keepExample: () => invoke('workspace:keepExample'),
    onRequested: (cb) => subscribe('workspace:requested', cb),
    onCloseAsked: (cb) => subscribe('window:closeAsked', cb),
    answerClose: (close) => ipcRenderer.send('window:closeAnswer', close)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    drawsControls: () => ipcRenderer.sendSync('window:drawsControls') === true,
    platform: process.platform,
    onMaximized: (cb) => subscribe('window:maximized', cb)
  },
  ready: {
    check: (fresh) => invoke('ready:check', fresh === true),
    make: () => invokePlain('ready:make'),
    onChanged: (cb) => subscribe('ready:changed', cb)
  },
  object: {
    open: (id) => invoke('object:open', id),
    rebuild: (id) => invoke('object:rebuild', id),
    setParam: (id, name, value) => invoke('object:setParam', id, name, value),
    resetParams: (id, name) => invoke('object:resetParams', id, name),
    drives: (id, name) => invoke('object:drives', id, name),
    loadSceneFile: (id) => invoke('object:sceneFile', id),
    saveSceneFile: (id, file) => ipcRenderer.send('object:saveSceneFile', id, file),
    onBuild: (cb) => subscribe('object:build', cb),
    onScene: (cb) => subscribe('object:scene', cb)
  },
  view: {
    report: (v) => ipcRenderer.send('view:report', v),
    onLook: (cb) => subscribe('view:look', cb),
    lookReply: (id, result) => ipcRenderer.send('view:lookReply', id, result),
    onShow: (cb) => subscribe('view:show', cb),
    showReply: (id, result) => ipcRenderer.send('view:showReply', id, result),
    onHighlight: (cb) => subscribe('view:highlight', cb),
    highlightReply: (id, result) => ipcRenderer.send('view:highlightReply', id, result),
    onDrawSection: (cb) => subscribe('view:drawSection', cb),
    drawSectionReply: (id, result) => ipcRenderer.send('view:drawSectionReply', id, result),
    onTracingPicture: (cb) => subscribe('view:tracingPicture', cb),
    tracingPictureReply: (id, result) => ipcRenderer.send('view:tracingPictureReply', id, result),
    onSaveView: (cb) => subscribe('view:saveView', cb),
    saveViewReply: (id, result) => ipcRenderer.send('view:saveViewReply', id, result)
  },
  asks: {
    list: () => invokePlain('asks:list'),
    onChanged: (cb) => subscribe('asks:changed', cb),
    answer: (id, answer) => ipcRenderer.send('asks:answer', id, answer)
  },
  marks: {
    list: (objectId) => invokePlain('marks:list', objectId),
    add: (objectId, mark) => invokePlain('marks:add', objectId, mark),
    addRegion: (objectId, region) => invokePlain('marks:addRegion', objectId, region),
    repaintRegion: (objectId, id, bits) => invokePlain('marks:repaintRegion', objectId, id, bits),
    update: (objectId, id, patch) => invokePlain('marks:update', objectId, id, patch),
    acknowledge: (objectId, ids) => invokePlain('marks:acknowledge', objectId, ids),
    remove: (objectId, id) => invokePlain('marks:remove', objectId, id),
    restore: (objectId, id) => invokePlain('marks:restore', objectId, id),
    replace: (objectId, id, placed) => invokePlain('marks:replace', objectId, id, placed),
    sketch: (draft) => invokePlain('marks:sketch', draft),
    span: (objectId, draft) => invokePlain('marks:span', objectId, draft),
    offset: (objectId, draft) => invokePlain('marks:offset', objectId, draft),
    sketchPicture: (objectId, id, png) => invokePlain('marks:sketchPicture', objectId, id, png),
    sketching: (objectId, id) => ipcRenderer.send('marks:sketching', objectId, id),
    round: (objectId, ask) => invokePlain('marks:round', objectId, ask),
    rounds: (objectId) => invokePlain('marks:rounds', objectId),
    setIntent: (objectId, id, intent) => invokePlain('marks:setIntent', objectId, id, intent),
    roundOut: (objectId, id) => invokePlain('marks:roundOut', objectId, id),
    judge: (objectId, id, verdict, note) => invokePlain('marks:judge', objectId, id, verdict, note),
    onChanged: (cb) => subscribe('marks:changed', cb),
    onProblem: (cb) => subscribe('marks:problem', cb),
    problem: (objectId) => invokePlain('marks:problem', objectId),
    dismissProblem: (objectId) => invokePlain('marks:dismissProblem', objectId)
  },
  sets: {
    list: (objectId) => invokePlain('sets:list', objectId),
    make: (objectId, ask, revision) => invokePlain('sets:make', objectId, ask, revision),
    edit: (objectId, id, edit, revision) => invokePlain('sets:edit', objectId, id, edit, revision),
    remove: (objectId, id) => invokePlain('sets:remove', objectId, id),
    restore: (objectId, id) => invokePlain('sets:restore', objectId, id),
    accept: (objectId, id) => invokePlain('sets:accept', objectId, id),
    dismiss: (objectId, id) => invokePlain('sets:dismiss', objectId, id),
    onChanged: (cb) => subscribe('sets:changed', cb),
    onProblem: (cb) => subscribe('sets:problem', cb),
    problem: (objectId) => invokePlain('sets:problem', objectId),
    dismissProblem: (objectId) => invokePlain('sets:dismissProblem', objectId)
  },
  shelf: {
    list: () => invokePlain('shelf:list'),
    measured: (id, name, value) => invokePlain('shelf:measured', id, name, value),
    onChanged: (cb) => subscribe('shelf:changed', cb)
  },
  tracings: {
    list: (objectId) => invokePlain('tracings:list', objectId),
    make: (objectId, ask) => invokePlain('tracings:make', objectId, ask),
    edit: (objectId, id, patch) => invokePlain('tracings:edit', objectId, id, patch),
    remove: (objectId, id) => invokePlain('tracings:remove', objectId, id),
    restore: (objectId, id) => invokePlain('tracings:restore', objectId, id),
    layer: (objectId, id, change) => invokePlain('tracings:layer', objectId, id, change),
    outline: (objectId, id) => invokePlain('tracings:outline', objectId, id),
    shown: (objectId, ids) => ipcRenderer.send('tracings:shown', objectId, ids),
    onChanged: (cb) => subscribe('tracings:changed', cb),
    onOutline: (cb) => subscribe('tracings:outline', cb),
    onProblem: (cb) => subscribe('tracings:problem', cb),
    problem: (objectId) => invokePlain('tracings:problem', objectId),
    dismissProblem: (objectId) => invokePlain('tracings:dismissProblem', objectId),
    photo: (objectId, id, bytes, from) => invokePlain('tracings:photo', objectId, id, bytes, from),
    lineUp: (objectId, id, pairs, method) => invokePlain('tracings:lineUp', objectId, id, pairs, method),
    look: (objectId, id, look) => invokePlain('tracings:look', objectId, id, look),
    straightened: (objectId, id, bytes, of) => invokePlain('tracings:straightened', objectId, id, bytes, of),
    photoBytes: (objectId, id, which) => invokePlain('tracings:photoBytes', objectId, id, which),
    removePhoto: (objectId, id) => invokePlain('tracings:removePhoto', objectId, id)
  },
  notes: {
    make: (draft) => invokePlain('notes:make', draft),
    edit: (objectId, id, patch) => invokePlain('notes:edit', objectId, id, patch),
    picture: (objectId, id, which) => invokePlain('notes:picture', objectId, id, which)
  },
  board: {
    read: (objectId) => invokePlain('board:read', objectId),
    change: (objectId, change) => invokePlain('board:change', objectId, change),
    tie: (objectId, cardId, markId, tolerance) => invokePlain('board:tie', objectId, cardId, markId, tolerance),
    picture: (objectId, name) => invokePlain('board:picture', objectId, name),
    brief: (objectId) => invokePlain('board:brief', objectId),
    reference: (objectId, file) => invokePlain('board:reference', objectId, file),
    addPicture: (objectId, bytes) => invokePlain('board:addPicture', objectId, bytes),
    pin: (objectId, what) => invokePlain('board:pin', objectId, what),
    open: (objectId, what) => invokePlain('board:open', objectId, what),
    openLink: (objectId, cardId, nth) => invokePlain('board:openLink', objectId, cardId, nth ?? 0),
    onChanged: (cb) => subscribe('board:changed', cb),
    problem: (objectId) => invokePlain('board:problem', objectId),
    dismissProblem: (objectId) => invokePlain('board:dismissProblem', objectId),
    seen: (objectId) => invokePlain('board:seen', objectId),
    markSeen: (objectId) => invokePlain('board:markSeen', objectId),
    aside: (objectId) => invokePlain('board:aside', objectId),
    useAside: (objectId, replace) => invokePlain('board:useAside', objectId, replace === true),
    undoAside: (objectId) => invokePlain('board:undoAside', objectId),
    letGoAside: (objectId) => invokePlain('board:letGoAside', objectId),
    onProblem: (cb) => subscribe('board:problem', cb)
  },
  objects: {
    pickPhotos: () => invokePlain('objects:pickPhotos'),
    pickScan: () => invokePlain('scans:pick'),
    pickStep: () => invokePlain('objects:pickStep'),
    pickPdf: () => invokePlain('objects:pickPdf'),
    pathOf: (file) => webUtils.getPathForFile(file),
    readPhoto: (path) => invokePlain('objects:readPhoto', path),
    create: (req) => invokePlain('objects:create', req),
    onboard: (objectId, draft) => invokePlain('objects:onboard', objectId, draft),
    previewPrompt: (name, draft) => invokePlain('objects:previewPrompt', name, draft),
    taken: () => invokePlain('objects:taken')
  },
  scans: {
    list: (objectId) => invokePlain('scans:list', objectId),
    pick: () => invokePlain('scans:pick'),
    pathOf: (file) => webUtils.getPathForFile(file),
    import: (objectId, path) => invokePlain('scans:import', objectId, path),
    reimport: (objectId, id) => invokePlain('scans:reimport', objectId, id),
    convert: (objectId, id, as) => invokePlain('scans:convert', objectId, id, as),
    rename: (objectId, id, name) => invokePlain('scans:rename', objectId, id, name),
    remove: (objectId, id) => invokePlain('scans:remove', objectId, id),
    align: (objectId: string, id: string, layout: string, alignment: NewAlignment | null, made?: AlignMade) => invokePlain('scans:align', objectId, id, layout, alignment, made),
    undoAlign: (objectId, id, layout) => invokePlain('scans:undoAlign', objectId, id, layout),
    alignHolds: (objectId, id, layout) => invokePlain('scans:alignHolds', objectId, id, layout),
    mesh: (objectId, id) => invokePlain('scans:mesh', objectId, id),
    mask: (objectId, id, markId) => invokePlain('scans:mask', objectId, id, markId),
    onChanged: (cb) => subscribe('scans:changed', cb),
    onProgress: (cb) => subscribe('scans:progress', cb),
    onProblem: (cb) => subscribe('scans:problem', cb),
    problem: (objectId) => invokePlain('scans:problem', objectId),
    dismissProblem: (objectId) => invokePlain('scans:dismissProblem', objectId)
  },
  geometry: {
    describe: (objectId, layout, ref) => invokePlain('geometry:describe', objectId, layout, ref),
    measure: (objectId, probe) => invokePlain('geometry:measure', objectId, probe)
  },
  show: {
    cards: () => invoke('show:cards'),
    thumbnail: (objectId) => invoke('show:thumbnail', objectId),
    saveThumbnail: (objectId, revision, png, of) => ipcRenderer.send('show:saveThumbnail', objectId, revision, png, of),
    onChanged: (cb) => subscribe<void>('show:changed', () => cb())
  },
  git: {
    status: (objectId) => invoke('git:status', objectId)
  },
  history: {
    list: (objectId) => invoke('history:list', objectId),
    thumbnail: (objectId, id) => invoke('history:thumbnail', objectId, id),
    source: (objectId, id, file) => invoke('history:source', objectId, id, file),
    ghost: (objectId, id) => invoke('history:ghost', objectId, id),
    star: (objectId, id, starred) => invoke('history:star', objectId, id, starred),
    goBackPlan: (objectId, prompt) => invoke('history:goBackPlan', objectId, prompt),
    goBack: (objectId, prompt, confirmed) => invoke('history:goBack', objectId, prompt, confirmed),
    onChanged: (cb) => subscribe<string>('history:changed', cb)
  },
  export: {
    plan: (req) => invokePlain('export:plan', req),
    save: (req) => invokePlain('export:save', req),
    savePicture: (objectId, png) => invokePlain('export:savePicture', objectId, png),
    saveSection: (objectId, as) => invokePlain('export:saveSection', objectId, as),
    saveTracing: (objectId, tracingId, as, ticks) => invokePlain('export:saveTracing', objectId, tracingId, as, ticks),
    reveal: () => invokePlain('export:reveal'),
    openSaved: () => invokePlain('export:openSaved'),
    done: () => ipcRenderer.send('export:done')
  },
  session: {
    current: (objectId) => invoke('session:current', objectId),
    start: (objectId, opts) => invoke('session:start', objectId, opts),
    trust: (objectId) => invoke('session:trust', objectId),
    instructions: (objectId) => invoke('session:instructions', objectId),
    revealInstruction: (objectId, index) => invokePlain('session:revealInstruction', objectId, index),
    write: (sessionId, data) => ipcRenderer.send('session:write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send('session:resize', sessionId, cols, rows),
    stop: (sessionId) => invoke('session:stop', sessionId),
    onData: (cb) => subscribe('session:data', cb),
    onStatus: (cb) => subscribe('session:status', cb),
    insert: (sessionId, text) => ipcRenderer.send('session:insert', sessionId, text),
    chooseView: (objectId, view) => invokePlain('session:chooseView', objectId, view)
  },
  chat: {
    history: (sessionId) => invokePlain('chat:history', sessionId),
    lastConversation: (objectId) => invokePlain('chat:lastConversation', objectId),
    prompts: (objectId) => invokePlain('chat:prompts', objectId),
    conversation: (objectId, conversationId) => invokePlain('chat:conversation', objectId, conversationId),
    reference: (sessionId, file) => invokePlain('chat:reference', sessionId, file),
    changes: (sessionId, turnId) => invokePlain('chat:changes', sessionId, turnId),
    undo: (sessionId, turnId) => invokePlain('chat:undo', sessionId, turnId),
    onItem: (cb) => subscribe('chat:item', cb),
    onMeta: (cb) => subscribe('chat:meta', cb),
    onCapabilities: (cb) => subscribe('chat:capabilities', cb),
    send: (sessionId, prompt) => invokePlain('chat:send', sessionId, prompt),
    answer: (sessionId, requestId, answer) => ipcRenderer.send('chat:answer', sessionId, requestId, answer),
    interrupt: (sessionId) => invokePlain('chat:interrupt', sessionId),
    setModel: (sessionId, model) => invokePlain('chat:setModel', sessionId, model),
    setMode: (sessionId, mode) => invokePlain('chat:setMode', sessionId, mode),
    setEffort: (sessionId, effort) => invokePlain('chat:setEffort', sessionId, effort),
    models: () => invokePlain('chat:models')
  },
  profile: {
    choices: () => invokePlain('profile:choices'),
    savePrinter: (printer) => invokePlain('profile:savePrinter', printer),
    saveMaterial: (material) => invokePlain('profile:saveMaterial', material),
    get: (objectId) => invokePlain('profile:get', objectId),
    set: (objectId, profile) => invokePlain('profile:set', objectId, profile)
  }
}

contextBridge.exposeInMainWorld('torno', bridge)
