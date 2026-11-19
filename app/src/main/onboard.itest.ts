import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ChatItem } from '../shared/chat'
import { box, stl } from '../test/scanFixtures'
import type { ObjectInfo } from '../shared/workspace'
import { type HttpRouter, startHttp } from './http'
import { scanCommand } from './kernel/client'
import { createObject } from './objects/create'
import { onboardObject, sessionRunning, type OnboardDeps } from './onboard'
import { ScanStore } from './scans/store'
import { processImporter } from './scans/importer'
import { BoardStore } from './board/store'
import { liveFacts } from './board/live'
import { boardLine } from './board/text'
import { claudeAdapter } from './sessions/claude'
import { Sessions } from './sessions/manager'
import type { StreamMessage } from './sessions/stream'

// A new object made by `createObject`, then onboarded with the real session manager (the stand-in agent, in its
// stream mode), the real scan import process and the real router: the stand-in is sent one prompt, with the text and
// the pictures, and the hook that answers every prompt answers this one.
const FAKE = resolve(__dirname, '../../test/fake-agent.mjs')
const KERNEL_DIR = resolve(__dirname, '../../../kernel')

/** A PNG header of w x h: enough for torno, which does not decode, and for the stand-in, which reads the size from it. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}

const SIZE = { what: 'cable', value: 'Ø6', unit: 'mm' as const, source: 'measured' as const }
const RULES = 'No supports.'
const LINK = { url: 'https://example.com/clip', note: 'the vendor' }

let root: string
/** torno's own folder of the files an agent is given by path, outside the workspace. */
let configDir: string
let http: HttpRouter
let sessions: Sessions
let scans: ScanStore
let board: BoardStore
const messages: StreamMessage[] = []
const objects = new Map<string, ObjectInfo>()

const live_ = (id: string) => liveFacts({ dir: objects.get(id)?.dir, marks: [], scene: undefined, overrides: () => ({}) })

function make(command: string): Sessions {
  const made = new Sessions({
    configDir,
    http,
    adapter: claudeAdapter(command),
    viewFor: () => 'chat',
    // As the app's prompt does: the line of the board, and what it told kept once the prompt is delivered.
    contextFor: async (id) => {
      const [file, told, live] = await Promise.all([board.read(id), board.told(id), live_(id)])
      const line = boardLine(file, told, live)
      return { text: `context for ${id}${line.line ? `\n${line.line}` : ''}`, sentMarkIds: [], ...(line.line ? { boardTold: line.told } : {}) }
    },
    onDelivered: (id, _marks, told) => {
      if (told) void board.markTold(id, told)
    },
    systemPromptFor: () => '',
    mcpUrlFor: (id) => http.url(`/mcp/${id}`)
  })
  made.on('stream', (m) => messages.push(m.message))
  return made
}

const depsOf = (s: Sessions): OnboardDeps => ({
  object: (id) => objects.get(id),
  running: (id) => sessionRunning(s, id),
  importScan: (id, path) => scans.import(id, path),
  start: (obj, choice) => s.start(obj, choice),
  prompt: (id, blocks) => s.prompt(id, blocks),
  began: (id) => s.began(id),
  boardTold: (id) => board.markAllTold(id),
  scene: () => undefined
})

/** Makes `<name>` with a photo, a doodle, a scan and a reference to `lid`, as the window would, and answers with what it would send on. */
async function made(name: string) {
  const photo = join(root, 'files', 'desk.png')
  const { objectId } = await createObject(
    { name, description: 'A clip for a 6 mm cable.', photos: [{ path: photo, note: 'the desk' }], doodles: [{ png: png(1200, 800), note: 'the shape' }], steps: [], scans: [], objects: [{ id: 'lid', note: 'mounts on this' }], sizes: [SIZE], rules: RULES, links: [LINK], pdfs: [{ path: join(root, 'files', 'cable.pdf'), note: 'the cable' }] },
    { root, objects: ['lid'] }
  )
  objects.set(objectId, { id: objectId, name: objectId, dir: join(root, objectId), model: null })
  return {
    objectId,
    draft: {
      description: 'A clip for a 6 mm cable.',
      items: [{ file: 'reference/photo-1.png', note: 'the desk', image: png(1280, 960) }, { file: 'reference/doodle-1.png', note: 'the shape', image: png(1200, 800) }],
      steps: [],
      scans: [{ path: join(root, 'files', 'edge.stl'), note: 'the edge' }],
      objects: [{ id: 'lid', note: 'mounts on this' }],
      sizes: [SIZE],
      rules: RULES,
      links: [LINK],
      pdfs: [{ file: 'reference/cable.pdf', note: 'the cable' }]
    }
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-onboard-'))
  mkdirSync(join(root, 'files'))
  writeFileSync(join(root, 'files', 'desk.png'), png(3000, 2000))
  writeFileSync(join(root, 'files', 'cable.pdf'), '%PDF-1.4\n')
  writeFileSync(join(root, 'files', 'edge.stl'), stl(box([40, 30, 5])))
  mkdirSync(join(root, 'lid'))
  writeFileSync(join(root, 'lid', 'lid.py'), '# lid\n')
  mkdirSync(join(root, 'lid', '.torno'))
  writeFileSync(join(root, 'lid', '.torno', 'thumb.png'), png(480, 360))
  objects.set('lid', { id: 'lid', name: 'lid', dir: join(root, 'lid'), model: null })
  configDir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-agent-config-'))
  http = await startHttp()
  sessions = make(`node ${FAKE}`)
  const importer = processImporter((args) => scanCommand({ workspaceRoot: root, hasProject: false, kernelDir: KERNEL_DIR }, args), root)
  board = new BoardStore({ dirOf: (id) => objects.get(id)?.dir, live: live_ })
  scans = new ScanStore({ dirOf: (id) => objects.get(id)?.dir, importer: () => importer })
})

afterEach(async () => {
  await sessions.stopAll()
  messages.length = 0
})

afterAll(async () => {
  await http.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(configDir, { recursive: true, force: true })
})

const userItem = (s: Sessions, id: string): Extract<ChatItem, { kind: 'user' }> =>
  s.history(id)!.items.find((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user')!

describe('onboarding a new object', () => {
  it('imports the scan, starts the chat and sends one prompt with the text and the pictures; the stand-in is answered by the hook as for any prompt', async () => {
    const { objectId, draft } = await made('cable-clip')
    const out = await onboardObject(depsOf(sessions), objectId, draft)
    expect(out.sessionId).not.toBeNull()
    expect(out.problem).toBeUndefined()

    // The scan is the object's: in its scans file, and listed.
    const file = JSON.parse(readFileSync(join(root, objectId, '.torno', 'scans.json'), 'utf8')) as { scans: Array<{ id: string; name: string }> }
    expect(file.scans.map((s) => s.id)).toEqual(['S1'])
    expect((await scans.list(objectId)).map((s) => s.id)).toEqual(['S1'])

    // One prompt, with its text and three pictures (the photo, the doodle, the picture of `lid`).
    await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 15000 }).toBe(1)
    const user = userItem(sessions, out.sessionId!)
    expect(user.text).toBe(out.prompt)
    expect(user.images).toHaveLength(3)
    expect(user.text).toContain('This is a new project, cable-clip')
    for (const note of ['the desk', 'the shape', 'the edge', 'mounts on this']) expect(user.text).toContain(note)
    expect(user.text).toContain('Scan S1 "edge.stl"')
    expect(user.text).toContain('../lid/ (another project of this workspace: not built in this run; its picture is attached: picture 3)')
    expect(sessions.history(out.sessionId!)!.items.filter((i) => i.kind === 'user')).toHaveLength(1)

    expect(user.text).toContain('Sizes the person gave:\n- cable Ø 6 mm (measured)')
    expect(user.text).toContain('Rules:\nNo supports.')
    expect(user.text).toContain('- https://example.com/clip: the vendor')
    expect(user.text).toContain('- reference/cable.pdf: the cable. A PDF; read it with your own tools if it helps.')

    // The hook answered this prompt with the context, like any other, and its board line counts the cards the prompt
    // said as cards, none of them new (brief, photo, doodle, size, rules, link, PDF).
    const context = (messages.find((m) => m.type === 'system' && m.subtype === 'hook_response') as unknown as { output: string }).output
    expect(context).toMatch(/^context for cable-clip\nBoard: 7 cards \(0 new\), frames /)
    expect(context).not.toMatch(/ new:/)
    expect(sessions.history(out.sessionId!)!.items.some((i) => i.kind === 'context' && i.text === context)).toBe(true)

    // And the object is the one `create` made, its brief holding the same notes.
    const brief = readFileSync(join(root, objectId, 'brief.md'), 'utf8')
    for (const note of ['the desk', 'the shape', 'mounts on this']) expect(brief).toContain(note)
  })

  it('would call every card and frame new if the board were not counted as told first', async () => {
    const { objectId, draft } = await made('uncounted')
    const out = await onboardObject({ ...depsOf(sessions), boardTold: undefined }, objectId, draft)
    await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 15000 }).toBe(1)
    const context = (messages.find((m) => m.type === 'system' && m.subtype === 'hook_response') as unknown as { output: string }).output
    expect(context).toMatch(/Board: 7 cards \(14 new: /)
    expect(out.problem).toBeUndefined()
  })

  it('refuses an object that has a session already, and imports and sends nothing more', async () => {
    const { objectId, draft } = await made('second')
    await onboardObject(depsOf(sessions), objectId, { ...draft, scans: [] })
    await expect(onboardObject(depsOf(sessions), objectId, draft)).rejects.toThrow(/session/)
    expect(await scans.list(objectId)).toEqual([])
  })

  it('holds the prompt again, with the exit note, for a CLI that starts and leaves before it takes the prompt up (signed out, too old)', async () => {
    process.env.FAKE_AGENT_FAIL = 'error: not logged in'
    try {
      const { objectId, draft } = await made('signed-out')
      const out = await onboardObject(depsOf(sessions), objectId, draft)
      expect(out.problem).toMatch(/Claude Code stopped \(exit code 1\): error: not logged in/)
      expect(out.held).toContain('This is a new project, signed-out')
      expect(out.held).not.toContain('attached: picture')
    } finally {
      delete process.env.FAKE_AGENT_FAIL
    }
  })

  it('gives the same exit note when the CLI has gone before began is asked (the other order of the same race)', async () => {
    process.env.FAKE_AGENT_FAIL = 'error: not logged in'
    try {
      const { objectId, draft } = await made('signed-out-late')
      const late: OnboardDeps = {
        ...depsOf(sessions),
        // Asked only once the CLI has left and its session is gone.
        began: async (id) => {
          await new Promise((r) => setTimeout(r, 1500))
          return sessions.began(id)
        }
      }
      const out = await onboardObject(late, objectId, draft)
      expect(out.problem).toMatch(/Claude Code stopped \(exit code 1\): error: not logged in/)
    } finally {
      delete process.env.FAKE_AGENT_FAIL
    }
  })

  it('answers with no session, the prompt and the reason when the agent\'s command is missing; the object stays whole', async () => {
    const lost = make('torno-no-such-agent-command')
    try {
      const { objectId, draft } = await made('no-agent')
      const out = await onboardObject(depsOf(lost), objectId, draft)
      expect(out.sessionId).toBeNull()
      expect(out.problem).toMatch(/not found on PATH/)
      expect(out.prompt).toContain('This is a new project, no-agent')
      expect(out.prompt).toContain('Scan S1 "edge.stl"')
      expect(out.held).not.toContain('attached: picture')
      expect(lost.current(objectId)).toBeNull()
      expect(readFileSync(join(root, objectId, 'brief.md'), 'utf8')).toContain('the desk')
    } finally {
      await lost.stopAll()
    }
  })
})
