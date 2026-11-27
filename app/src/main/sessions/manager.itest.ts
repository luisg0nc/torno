import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentView, SessionStatus } from '../../shared/bridge'
import type { ObjectInfo } from '../../shared/workspace'
import { type HttpRouter, readBody, SESSION_HEADER, startHttp } from '../http'
import { Trust } from '../trust'
import { claudeAdapter } from './claude'
import { killGroup, Sessions } from './manager'
import type { ChatItem, ChatMeta, Effort, Mode } from '../../shared/chat'
import type { PromptBlock, StreamMessage } from './stream'
import type { BuildState } from '../../shared/build'
import type { BoardAttach } from '../../shared/board'
import type { NoteMark } from '../../shared/marks'
import { writeNoteFile } from '../notes/files'
import { png as notePng } from '../notes/testing'
import { attachBoard, type BoardAttachment } from '../board/attach'
import { savePicture } from '../board/pictures'
import { BoardStore } from '../board/store'
import { Expectations, withExpectation } from '../mcp/expectTools'
import type { ToolDeps } from '../mcp/tools'
import { buildContextFor, contextFor, type ContextDeps, type PromptContext } from '../context'
import { startKernel } from '../kernel/client'
import type { Scene } from '../../shared/scene'
import { listReferences } from './reference'
import { takeNotices } from '../notices'
import { keepRenameNotice } from '../rename'
import type { BuildVerdicts } from '../verdicts'

// The session manager with a real PTY and a real HTTP server; only the agent is
// a stand-in (test/fake-agent.mjs), launched with Claude Code's arguments.
const FAKE = resolve(__dirname, '../../../test/fake-agent.mjs')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let root: string
/** torno's own folder of the files an agent is given by path: never in a workspace, as `<userData>/agent` is not. */
let configDir: string
let http: HttpRouter
/** Every token a router of these tests made, with the paths it opens: a session's is the one that opens its hooks. */
const grants: Array<{ token: string; paths: string[] }> = []
/** A router that records the tokens it makes, so that a test can post a hook as that session's agent does. */
function recording(router: HttpRouter): HttpRouter {
  const grant = router.grant
  router.grant = (paths) => {
    const token = grant(paths)
    grants.push({ token, paths })
    return token
  }
  return router
}
/** The token of a session, which its agent has in its environment. */
const tokenOf = (sessionId: string): string => grants.find((g) => g.paths.includes(`/hooks/${sessionId}`))!.token
/** The header a request of that session's agent carries. */
const as = (sessionId: string): Record<string, string> => ({ [SESSION_HEADER]: tokenOf(sessionId) })
let sessions: Sessions
let context = (id: string) => `context for ${id}`
/** By object: the marks its next prompt would tell of. What was delivered is taken out, as the store would. */
let drafts = new Map<string, string[]>()
let delivered: Array<{ objectId: string; sentMarkIds: string[] }> = []
/** Each time the context of a prompt was asked for: of which object, and whether in a conversation that had not been given one. */
let asked: Array<{ objectId: string; fresh: boolean; newConversation: boolean; first: boolean }> = []
/** What the context waits for before it is given, and what is told when it is asked for. */
let gate: Promise<void> = Promise.resolve()
let asking: (() => void) | null = null
let output = new Map<string, string>()
/** When a test sets it, the context a prompt is answered with. */
let answer: ((id: string, opts: { fresh: boolean; newConversation: boolean; first: boolean }) => PromptContext) | null = null
let statuses = new Map<string, SessionStatus[]>()

function object(id: string): ObjectInfo {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  return { id, name: id, dir, model: null }
}

/** The view each object is started in: the terminal unless a test names the chat. */
let views = new Map<string, AgentView>()

function make(command = `node ${FAKE}`): Sessions {
  const made = new Sessions({
    configDir,
    http,
    adapter: claudeAdapter(command),
    viewFor: (obj) => views.get(obj.id) ?? 'terminal',
    contextFor: async (id, opts) => {
      asking?.()
      asked.push({ objectId: id, fresh: opts.fresh, newConversation: opts.newConversation, first: opts.first })
      await gate
      if (answer) return answer(id, opts)
      return { text: context(id), sentMarkIds: drafts.get(id) ?? [] }
    },
    onDelivered: (objectId, sentMarkIds) => {
      delivered.push({ objectId, sentMarkIds })
      drafts.delete(objectId)
    },
    systemPromptFor: () => '',
    mcpUrlFor: (id) => http.url(`/mcp/${id}`)
  })
  made.on('data', (m) => output.set(m.sessionId, (output.get(m.sessionId) ?? '') + m.data))
  made.on('status', (m) => statuses.set(m.sessionId, [...(statuses.get(m.sessionId) ?? []), m.status]))
  return made
}

/** Sessions made by a test for itself, to be ended after it. */
let others: Sessions[] = []

const said = (id: string) => output.get(id) ?? ''
const sessionFile = (id: string) => JSON.parse(readFileSync(join(root, id, '.torno', 'session.json'), 'utf8'))
/** The whole READY line: a terminal delivers it in pieces (a Mac's pty cuts at 1 KiB), so the first piece is not it. */
const READY_LINE = /READY \[[^\n]*\]\r?\n/

/** The arguments the agent was started with, from its READY line. */
const argv = (id: string): string[] => argv2(said(id))
const argv2 = (out: string): string[] => JSON.parse(/READY (\[.*\])/.exec(out)![1])

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-sessions-'))
  configDir = mkdtempSync(join(realpathSync(tmpdir()), 'torno-agent-config-'))
  http = recording(await startHttp())
  sessions = make()
})

afterEach(async () => {
  await sessions.stopAll()
  await Promise.all(others.map((made) => made.stopAll()))
  others = []
  output = new Map()
  statuses = new Map()
  context = (id) => `context for ${id}`
  drafts = new Map()
  views = new Map()
  delivered = []
  gate = Promise.resolve()
  asking = null
  answer = null
})

afterAll(async () => {
  await http.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(configDir, { recursive: true, force: true })
})

describe('a session', () => {
  it('runs the agent in the object folder with the launch arguments', async () => {
    const { sessionId } = await sessions.start(object('bracket'), { cols: 100, rows: 30 })
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const args = argv(sessionId)
    expect(args[args.indexOf('--session-id') + 1]).toMatch(UUID)
    expect(JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.torno.url).toBe(http.url('/mcp/bracket'))
    expect(args).not.toContain('--append-system-prompt')
    expect(sessions.current('bracket')).toMatchObject({ sessionId, status: 'idle', cols: 100, rows: 30 })
  })

  it('echoes what is written to it', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.write(sessionId, 'hello\r')
    await expect.poll(() => said(sessionId)).toContain('> hello')
  })

  it('inserts text at the input as a paste, without sending it', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.insert(sessionId, 'base/F5 post/E2')
    // The terminal shows what was put in; the agent has been given no line yet.
    await expect.poll(() => said(sessionId)).toContain('base/F5 post/E2')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(said(sessionId)).not.toContain('> ')
    sessions.write(sessionId, '\r')
    await expect.poll(() => said(sessionId)).toContain('> \\e[200~base/F5 post/E2\\e[201~')
  })

  it('takes escapes and control characters out of what it inserts', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    // A newline would send the prompt, and an end-of-paste would let what follows be typed as keys.
    sessions.insert(sessionId, 'a\x1b[201~b\r\nc\x07\x03d\x7f\u009be\tf')
    sessions.write(sessionId, '\r')
    await expect.poll(() => said(sessionId)).toContain('> \\e[200~a[201~bcdef\\e[201~')
    // Nothing left to insert: nothing is written, not even an empty paste.
    sessions.insert(sessionId, '\x1b\n')
    sessions.write(sessionId, 'x\r')
    await expect.poll(() => said(sessionId)).toContain('> x')
  })

  it('inserts nothing into a session that has ended', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    await sessions.stop(sessionId)
    const before = said(sessionId)
    expect(() => sessions.insert(sessionId, 'base/F5')).not.toThrow()
    expect(() => sessions.insert('no-such-session', 'base/F5')).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(said(sessionId)).toBe(before)
  })

  it('goes from starting to idle to working, and gives the prompt its context', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    expect(existsSync(join(root, 'bracket', '.torno', 'session.json'))).toBe(false)
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    expect(statuses.get(sessionId)).toEqual(['starting', 'idle'])
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => said(sessionId)).toContain('context: context for bracket')
    expect(statuses.get(sessionId)).toEqual(['starting', 'idle', 'working'])

    // The conversation is on file from the first hook: it can be resumed from then on.
    const args = argv(sessionId)
    const file = sessionFile('bracket')
    expect(file.conversationId).toBe(args[args.indexOf('--session-id') + 1])
    expect(Date.parse(file.updatedAt)).not.toBeNaN()

    sessions.write(sessionId, 'hook PermissionRequest\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('needs_input')
    // The question was answered and the tool runs: it is working again.
    sessions.write(sessionId, 'hook PostToolUse\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('working')
    sessions.write(sessionId, 'hook PermissionRequest\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('needs_input')
    sessions.write(sessionId, 'hook PreToolUse\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('working')
    sessions.write(sessionId, 'hook Stop\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('idle')
  })

  // #132: a question of torno's own (`ask`) is open as long as the person takes, and no hook says so.
  it('shows needs_input while a question of torno\'s own is held, whatever the hooks of other tools say, and works again after', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.write(sessionId, 'hook PreToolUse\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('working')
    const release = sessions.holdAsk('bracket')
    expect(statuses.get(sessionId)?.at(-1)).toBe('needs_input')
    // A tool that ran side by side with it ends: that is no answer.
    sessions.write(sessionId, 'hook PostToolUse\r')
    await expect.poll(() => said(sessionId)).toContain('PostToolUse')
    expect(statuses.get(sessionId)?.at(-1)).toBe('needs_input')
    release()
    release()
    expect(statuses.get(sessionId)?.at(-1)).toBe('working')
    // None for an object with no session.
    expect(() => sessions.holdAsk('nothing')()).not.toThrow()
  })

  it("consumes the drafts of the prompt's own object, once, and of no other", async () => {
    drafts = new Map([
      ['bracket', ['M1', 'M2']],
      ['cover', ['M1']]
    ])
    const a = await sessions.start(object('bracket'), {})
    const b = await sessions.start(object('cover'), {})
    await expect.poll(() => said(a.sessionId)).toMatch(READY_LINE)
    await expect.poll(() => said(b.sessionId)).toMatch(READY_LINE)

    sessions.write(a.sessionId, 'hook\r')
    await expect.poll(() => said(a.sessionId)).toContain('context: context for bracket')
    await expect.poll(() => delivered).toEqual([{ objectId: 'bracket', sentMarkIds: ['M1', 'M2'] }])
    // The drafts of the other object are still its own to send.
    expect(drafts.get('cover')).toEqual(['M1'])

    // A second prompt in a row has nothing left to send.
    sessions.write(a.sessionId, 'hook\r')
    await expect.poll(() => said(a.sessionId).match(/context: context for bracket/g)?.length).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(delivered).toHaveLength(1)

    sessions.write(b.sessionId, 'hook\r')
    await expect.poll(() => delivered.at(-1)).toEqual({ objectId: 'cover', sentMarkIds: ['M1'] })
    expect(delivered).toHaveLength(2)
  })

  it('consumes nothing when the agent hung up before the answer was written', async () => {
    drafts = new Map([['bracket', ['M1']]])
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    let open!: () => void
    gate = new Promise<void>((resolve) => (open = resolve))
    const asked = new Promise<void>((resolve) => (asking = resolve))
    // The hook as the agent posts it, given up on while torno is still putting the answer together.
    const gone = new AbortController()
    const post = fetch(http.url(`/hooks/${sessionId}/UserPromptSubmit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...as(sessionId) },
      body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }),
      signal: gone.signal
    })
    await asked
    gone.abort()
    await expect(post).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 100))
    open()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(delivered).toEqual([])
    expect(drafts.get('bracket')).toEqual(['M1'])

    // The next prompt, which is answered, takes them.
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => delivered).toEqual([{ objectId: 'bracket', sentMarkIds: ['M1'] }])
  })

  it('consumes nothing on any hook but that of a prompt', async () => {
    drafts = new Map([['bracket', ['M1']]])
    let asked = 0
    context = (id) => {
      asked += 1
      return `context for ${id}`
    }
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    for (const event of ['Stop', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'SessionEnd']) {
      sessions.write(sessionId, `hook ${event}\r`)
      await expect.poll(() => said(sessionId)).toContain(`${event}: ok`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Not even asked for: there is no prompt to go with.
    expect(asked).toBe(0)
    expect(delivered).toEqual([])
    expect(drafts.get('bracket')).toEqual(['M1'])
  })

  it('consumes nothing when there is no text to carry the marks, or the context cannot be had', async () => {
    drafts = new Map([['bracket', ['M1']]])
    context = () => ''
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => said(sessionId)).toContain('context: (none)')
    context = () => {
      throw new Error('the marks file cannot be read')
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => said(sessionId).match(/context: \(none\)/g)?.length).toBe(2)
    expect(logged).toHaveBeenCalledWith('no context for the prompt in bracket: the marks file cannot be read')
    logged.mockRestore()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(delivered).toEqual([])
  })

  it('answers a prompt with nothing when there is no context', async () => {
    context = () => ''
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => said(sessionId)).toContain('context: (none)')
  })

  it('offers nothing to resume when the agent left without a prompt', async () => {
    // Claude Code posts SessionEnd, with the id it was started with, even when nothing was asked:
    // it keeps no such conversation, and `--resume` of it fails.
    const { sessionId } = await sessions.start(object('lid'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    for (const event of ['Notification', 'SessionEnd']) {
      sessions.write(sessionId, `hook ${event}\r`)
      await expect.poll(() => said(sessionId)).toContain(`${event}: ok`)
    }
    expect(existsSync(join(root, 'lid', '.torno'))).toBe(false)
    expect(sessions.resumable(object('lid'))).toBe(false)
  })

  it('follows the conversation when the agent starts another, and resumes that one', async () => {
    const other = '7c1f0c0e-3a54-4f0b-8a3e-5d2b9f6a1c11'
    const first = await sessions.start(object('lid'), {})
    await expect.poll(() => said(first.sessionId)).toMatch(READY_LINE)
    expect(sessions.resumable(object('lid'))).toBe(false)
    sessions.write(first.sessionId, `hook Stop ${other}\r`)
    await expect.poll(() => said(first.sessionId)).toContain('Stop: ok')
    expect(sessionFile('lid').conversationId).toBe(other)
    // Not a conversation id: the file keeps what it has.
    sessions.write(first.sessionId, 'hook Notification ../../x\r')
    await expect.poll(() => said(first.sessionId)).toContain('Notification: ok')
    expect(sessionFile('lid').conversationId).toBe(other)
    // The end of a conversation (/clear) is not the end of the session: that is when the process goes.
    sessions.write(first.sessionId, `hook SessionEnd ${other}\r`)
    await expect.poll(() => said(first.sessionId)).toContain('SessionEnd: ok')
    expect(statuses.get(first.sessionId)).toEqual(['starting', 'idle', 'needs_input'])
    expect(sessions.current('lid')?.sessionId).toBe(first.sessionId)
    await sessions.stop(first.sessionId)

    expect(sessions.resumable(object('lid'))).toBe(true)
    const second = await sessions.start(object('lid'), { resume: true })
    await expect.poll(() => said(second.sessionId)).toMatch(READY_LINE)
    const args = argv(second.sessionId)
    expect(args[args.indexOf('--resume') + 1]).toBe(other)
    expect(args).not.toContain('--session-id')
  })

  it('tells a new conversation the files of reference/, and not one it resumes', async () => {
    const obj = object('clip')
    mkdirSync(join(obj.dir, 'reference'), { recursive: true })
    writeFileSync(join(obj.dir, 'reference', 'photo-1.jpg'), 'x')
    answer = (id, opts) =>
      contextFor({ object: (o) => (o === id ? obj : undefined), build: () => undefined, scene: () => undefined, view: () => undefined, openObjectId: () => id, references: () => listReferences(obj.dir) }, id, [], opts)
    const real = sessions
    let out = ''
    // The manager has no way to stop listening: this one only stops hearing.
    let listening = true
    real.on('data', (m) => void (listening && (out += m.data)))
    const first = await real.start(obj, {})
    await expect.poll(() => out).toMatch(READY_LINE)
    real.write(first.sessionId, 'hook\r')
    await expect.poll(() => out).toContain('reference/: photo-1.jpg')
    // The next prompt of that conversation is not told again.
    const told = out.split('reference/: photo-1.jpg').length
    real.write(first.sessionId, 'hook\r')
    await expect.poll(() => out.split('context: ').length).toBe(3)
    await real.stop(first.sessionId)
    expect(out.split('reference/: photo-1.jpg').length).toBe(told)

    out = ''
    const second = await real.start(obj, { resume: true })
    await expect.poll(() => out).toMatch(READY_LINE)
    expect(argv2(out)).toContain('--resume')
    real.write(second.sessionId, 'hook\r')
    await expect.poll(() => out).toContain('context: ')
    expect(out).not.toContain('reference/')
    listening = false
  })

  // #50: what Claude Code reads of the folder is told with the first prompt of a session, a resumed one too, and once.
  it('says the first prompt of a session is the first, resumed or not, and no other', async () => {
    const obj = object('first')
    const fresh = await sessions.start(obj, {})
    await expect.poll(() => said(fresh.sessionId)).toMatch(READY_LINE)
    asked = []
    for (let i = 1; i <= 3; i += 1) {
      sessions.write(fresh.sessionId, 'hook\r')
      await expect.poll(() => asked.length).toBe(i)
    }
    expect(asked.map((a) => a.first)).toEqual([true, false, false])
    await sessions.stop(fresh.sessionId)
    const resumed = await sessions.start(obj, { resume: true })
    await expect.poll(() => said(resumed.sessionId)).toMatch(READY_LINE)
    asked = []
    for (let i = 1; i <= 2; i += 1) {
      sessions.write(resumed.sessionId, 'hook\r')
      await expect.poll(() => asked.length).toBe(i)
    }
    // A conversation resumed is not a new one, yet its first prompt is the session's first.
    expect(asked.map((a) => [a.newConversation, a.first])).toEqual([[false, true], [false, false]])
  })

  it('is the one session of its object: starting again returns it', async () => {
    const first = await sessions.start(object('bracket'), {})
    expect((await sessions.start(object('bracket'), {})).sessionId).toBe(first.sessionId)
    expect((await sessions.start(object('other'), {})).sessionId).not.toBe(first.sessionId)
  })

  it('says where it stands when it is started: starting when new, as it is when it was already running', async () => {
    const first = await sessions.start(object('bracket'), {})
    expect(first.status).toBe('starting')
    await expect.poll(() => said(first.sessionId)).toMatch(READY_LINE)
    expect(await sessions.start(object('bracket'), {})).toMatchObject({ sessionId: first.sessionId, status: 'idle' })
    sessions.write(first.sessionId, 'hook\r')
    await expect.poll(() => statuses.get(first.sessionId)?.at(-1)).toBe('working')
    expect((await sessions.start(object('bracket'), {})).status).toBe('working')
  })

  it('names the object a session is of, until it has been hung up on', async () => {
    const obj = object('bracket')
    const { sessionId } = await sessions.start(obj, {})
    expect(sessions.objectOf(sessionId)).toEqual({ id: 'bracket', dir: obj.dir })
    expect(sessions.objectOf('no-such-session')).toBeUndefined()
    void sessions.stop(sessionId)
    expect(sessions.objectOf(sessionId)).toBeUndefined()
  })

  it('gives way to a new session as soon as it is told to stop', async () => {
    const first = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(first.sessionId)).toMatch(READY_LINE)
    const gone = sessions.stop(first.sessionId)
    const second = await sessions.start(object('bracket'), {})
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(sessions.current('bracket')?.sessionId).toBe(second.sessionId)
    await gone
    await expect.poll(() => said(second.sessionId)).toMatch(READY_LINE)
    expect(statuses.get(first.sessionId)?.at(-1)).toBe('exited')
    expect(sessions.current('bracket')).toMatchObject({ sessionId: second.sessionId, status: 'idle' })
  })

  it('stops: the process ends, the status is exited, its hooks are gone', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const pid = sessions.current('bracket')!.pid
    expect(alive(pid)).toBe(true)
    await sessions.stop(sessionId)
    expect(alive(pid)).toBe(false)
    expect(statuses.get(sessionId)).toEqual(['starting', 'idle', 'exited'])
    expect(sessions.current('bracket')).toBeNull()
    // Its token opens nothing any more.
    const reply = await fetch(http.url(`/hooks/${sessionId}/Stop`), { method: 'POST', body: '{}', headers: as(sessionId) })
    expect(reply.status).toBe(404)
    // Writes to a session that is gone are dropped.
    sessions.write(sessionId, 'x')
    sessions.resize(sessionId, 10, 10)
    await sessions.stop(sessionId)
  })

  it('is exited when the agent exits by itself', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.write(sessionId, 'exit\r')
    await expect.poll(() => statuses.get(sessionId)?.at(-1)).toBe('exited')
  })

  it('kills an agent that ignores the hangup, two seconds later', async () => {
    process.env.FAKE_AGENT_STUBBORN = '1'
    try {
      const { sessionId } = await sessions.start(object('bracket'), {})
      await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
      const pid = sessions.current('bracket')!.pid
      const began = Date.now()
      await sessions.stopAll()
      expect(Date.now() - began).toBeGreaterThanOrEqual(1900)
      expect(Date.now() - began).toBeLessThan(4000)
      expect(alive(pid)).toBe(false)
    } finally {
      delete process.env.FAKE_AGENT_STUBBORN
    }
  })

  it('kills what the agent started along with it', async () => {
    process.env.FAKE_AGENT_STUBBORN = '1'
    try {
      const { sessionId } = await sessions.start(object('bracket'), {})
      await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
      sessions.write(sessionId, 'child\r')
      await expect.poll(() => said(sessionId)).toMatch(/child: \d+/)
      const child = Number(/child: (\d+)/.exec(said(sessionId))![1])
      const pid = sessions.current('bracket')!.pid
      expect(alive(child)).toBe(true)
      await sessions.stopAll()
      expect(alive(pid)).toBe(false)
      // Its exit is not waited for: it is in the same process group, and goes with it.
      await expect.poll(() => alive(child)).toBe(false)
    } finally {
      delete process.env.FAKE_AGENT_STUBBORN
    }
  })

  it('no longer puts a conversation on file once it has been hung up on', async () => {
    process.env.FAKE_AGENT_STUBBORN = '1'
    try {
      const { sessionId } = await sessions.start(object('hungup'), {})
      await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
      const gone = sessions.stop(sessionId)
      // The agent has two seconds left, and posts a hook in them.
      sessions.write(sessionId, 'hook\r')
      await expect.poll(() => said(sessionId)).toContain('context: ')
      await gone
      expect(existsSync(join(root, 'hungup', '.torno', 'session.json'))).toBe(false)
      expect(sessions.resumable(object('hungup'))).toBe(false)
    } finally {
      delete process.env.FAKE_AGENT_STUBBORN
    }
  })

  it('gives the agent torno\'s environment without what is torno\'s own or another Claude Code\'s', async () => {
    const mine: Record<string, string> = {
      TORNO_TEST: '1',
      TORNO_AGENT_CMD: 'x',
      TORNO_CONFIG: '/x',
      TORNO_WORKSPACE: '/x',
      TORNO_DEBUG: '1',
      TORNO_SHOTS: '/x',
      TORNO_BUILD_TIMEOUT: '900',
      // The suites' own switch for the kernel: an agent's kernel, were it to start one, lets builds go as ever.
      TORNO_KEEP_BUILDS: '1',
      // What a Claude Code session exports to what it starts.
      CLAUDECODE: '1',
      CLAUDE_CODE_BRIDGE_SESSION_ID: 'x',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/x',
      CLAUDE_CODE_MESSAGING_SOCKET: '/x',
      CLAUDE_CODE_MESSAGING_TOKEN: 'x',
      CLAUDE_CODE_SESSION_ATTENDED: '1',
      CLAUDE_CODE_SESSION_ID: 'x',
      CLAUDE_EFFORT: 'high',
      CLAUDE_PID: '1',
      // What a person sets on purpose.
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_OAUTH_TOKEN: 'kept',
      CLAUDE_CONFIG_DIR: '/kept',
      ANTHROPIC_KEPT_FOR_TEST: 'kept'
    }
    // The suite may itself run inside a Claude Code session, whose own CLAUDE* and TORNO* variables would be among
    // what the agent is given: the launch gets this environment alone, whatever the shell it runs in has.
    const own = Object.keys(process.env).filter((name) => /^(CLAUDE|TORNO)/.test(name) && !(name in mine))
    const before = Object.fromEntries([...Object.keys(mine), ...own].map((name) => [name, process.env[name]]))
    for (const name of own) delete process.env[name]
    Object.assign(process.env, mine)
    try {
      const { sessionId } = await sessions.start(object('bracket'), {})
      sessions.write(sessionId, 'env\r')
      await expect.poll(() => said(sessionId)).toMatch(/env: (\[.*?\])\r?\n/)
      const names: string[] = JSON.parse(/env: (\[.*?\])\r?\n/.exec(said(sessionId))![1])
      expect(names.filter((name) => name.startsWith('TORNO'))).toEqual(['TORNO_OBJECT', 'TORNO_SESSION', 'TORNO_SESSION_ID'])
      // Of Claude Code's, only the marks of a parent session are withheld: the person's own settings pass.
      expect(names.filter((name) => name.startsWith('CLAUDE')).sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR'])
      // Everything else is passed on.
      for (const name of ['ANTHROPIC_KEPT_FOR_TEST', 'HOME', 'PATH']) expect(names).toContain(name)
    } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it('says so when the agent command is not installed', async () => {
    const none = make('torno-no-such-agent')
    await expect(none.start(object('bracket'), {})).rejects.toThrow(/torno-no-such-agent.*not found/)
    expect(none.current('bracket')).toBeNull()
  })

  it('starts one session when asked twice at once, and ends one that was still starting when all are stopped', async () => {
    const obj = object('twice')
    const [a, b] = await Promise.all([sessions.start(obj, {}), sessions.start(obj, {})])
    expect(a.sessionId).toBe(b.sessionId)
    expect(sessions.size).toBe(1)
    await sessions.stop(a.sessionId)
    const late = sessions.start(obj, {})
    expect(sessions.isStarting('twice')).toBe(true)
    await sessions.stopAll()
    expect(sessions.current('twice')).toBeNull()
    expect(sessions.size).toBe(0)
    await late
  })

  it('resumes the conversation of Claude Code that a file written by an older torno keeps beside another agent\'s', async () => {
    const obj = object('older')
    const claudes = '2c1e5a52-6d0c-4f6e-9a55-2f4a3c1d9e10'
    mkdirSync(join(obj.dir, '.torno'), { recursive: true })
    // As the torno that also ran Copilot CLI left it, that agent's conversation last.
    writeFileSync(join(obj.dir, '.torno', 'session.json'), JSON.stringify({ conversationId: '3d1e5a52-6d0c-4f6e-9a55-2f4a3c1d9e10', agent: 'copilot', kept: { claude: { conversationId: claudes } } }))
    expect(sessions.resumable(obj)).toBe(true)
    const { sessionId } = await sessions.start(obj, { resume: true })
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const args = argv(sessionId)
    expect(args[args.indexOf('--resume') + 1]).toBe(claudes)
    // Written anew, it is Claude Code's alone.
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => said(sessionId)).toContain('context:')
    expect(sessionFile('older')).toEqual({ conversationId: claudes, agent: 'claude', updatedAt: expect.any(String) })
  })

  it('offers nothing to resume when the file holds no conversation of Claude Code\'s', () => {
    const obj = object('another')
    mkdirSync(join(obj.dir, '.torno'), { recursive: true })
    writeFileSync(join(obj.dir, '.torno', 'session.json'), JSON.stringify({ conversationId: '3d1e5a52-6d0c-4f6e-9a55-2f4a3c1d9e10', agent: 'copilot' }))
    expect(sessions.resumable(obj)).toBe(false)
  })
})

describe('stopAll', () => {
  it('ends the sessions there were and those that were starting, and none started while it waited', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const made = new Sessions({
      configDir,
      http,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: async (obj): Promise<AgentView> => {
        if (obj.id === 'slow-start') await held
        return 'terminal'
      },
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => http.url(`/mcp/${id}`)
    })
    others.push(made)
    const slow = made.start(object('slow-start'), {})
    expect(made.busy).toBe(true)
    expect(made.size).toBe(0)
    const stopping = made.stopAll()
    // Of the workspace opened meanwhile: not what was asked to end.
    const next = await made.start(object('next-workspace'), {})
    release()
    await stopping
    await slow
    expect(made.current('slow-start')).toBeNull()
    expect(made.current('next-workspace')).toMatchObject({ sessionId: next.sessionId })
    await made.stopAll()
    expect(made.busy).toBe(false)
  })
})

describe('the hook endpoint', () => {
  it('knows only live sessions, only POST, and only bodies it can read', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    const url = http.url(`/hooks/${sessionId}/Stop`)
    const headers = as(sessionId)
    expect((await fetch(http.url('/hooks/nobody/Stop'), { method: 'POST', body: '{}', headers })).status).toBe(404)
    expect((await fetch(http.url(`/hooks/${sessionId}`), { method: 'POST', body: '{}', headers })).status).toBe(404)
    expect((await fetch(url, { headers })).status).toBe(405)
    expect((await fetch(url, { method: 'POST', body: 'not json', headers })).status).toBe(400)
    const fine = await fetch(url, { method: 'POST', body: '{}', headers })
    expect(fine.status).toBe(200)
    expect(fine.headers.get('content-type')).toBe('application/json')
    expect(await fine.json()).toEqual({})
    expect((await fetch(http.url('/elsewhere'), { method: 'POST', body: '{}', headers })).status).toBe(404)
  })

  it('knows only the hooks of the agent: no other name moves the status', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    // `exit` and `output` are what the PTY tells the session, not hooks.
    for (const name of ['exit', 'output', 'SessionStart', 'stop']) {
      const reply = await fetch(http.url(`/hooks/${sessionId}/${name}`), { method: 'POST', body: '{}', headers: as(sessionId) })
      expect(reply.status).toBe(404)
    }
    expect(statuses.get(sessionId)).toEqual(['starting', 'idle'])
    expect(sessions.current('bracket')?.status).toBe('idle')
    for (const name of ['UserPromptSubmit', 'Stop', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'SessionEnd']) {
      expect((await fetch(http.url(`/hooks/${sessionId}/${name}`), { method: 'POST', body: '{}', headers: as(sessionId) })).status).toBe(200)
    }
  })

  it('reads what a Notification says: one that the agent has only been idle a while is no question', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const notify = (body: object) => fetch(http.url(`/hooks/${sessionId}/Notification`), { method: 'POST', body: JSON.stringify(body), headers: as(sessionId) })
    // Seen on a visible screen: the header said "Needs input" with Claude Code at its empty prompt.
    expect((await notify({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })).status).toBe(200)
    expect(sessions.current('bracket')?.status).toBe('idle')
    expect((await notify({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' })).status).toBe(200)
    await expect.poll(() => sessions.current('bracket')?.status).toBe('needs_input')
  })

  it('does not read what a tool hook carries: a tool result of megabytes moves the status and is answered', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const body = JSON.stringify({ tool_response: 'x'.repeat(2 * 1024 * 1024) })
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const reply = await fetch(http.url(`/hooks/${sessionId}/${event}`), { method: 'POST', body, headers: as(sessionId) })
      expect(reply.status).toBe(200)
      expect(await reply.json()).toEqual({})
    }
    expect(statuses.get(sessionId)?.at(-1)).toBe('working')
    // Nor is it parsed: what is not JSON is as good.
    expect((await fetch(http.url(`/hooks/${sessionId}/PostToolUse`), { method: 'POST', body: 'not json', headers: as(sessionId) })).status).toBe(200)
  })

  it('says a prompt is in a conversation that has not seen the marks when the agent names another than before, once', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    asked = []
    const prompt = async (conversation = ''): Promise<void> => {
      const before = asked.length
      sessions.write(sessionId, `hook UserPromptSubmit ${conversation}\r`)
      await expect.poll(() => asked.length).toBe(before + 1)
    }
    // The conversation it was started with, twice: nothing new.
    await prompt()
    await prompt()
    // After /clear the agent names another.
    await prompt('11111111-2222-4333-8444-555555555555')
    await prompt('11111111-2222-4333-8444-555555555555')
    await prompt('99999999-2222-4333-8444-555555555555')
    expect(asked.map((a) => a.fresh)).toEqual([false, false, true, false, true])
  })

  it('tells the marks and the references again after a compaction (PostCompact), once, and the hook moves no status', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    asked = []
    const prompt = async (event = 'UserPromptSubmit'): Promise<void> => {
      const before = asked.length
      sessions.write(sessionId, `hook ${event}\r`)
      if (event === 'UserPromptSubmit') await expect.poll(() => asked.length).toBe(before + 1)
    }
    await prompt()
    await prompt('PostCompact')
    await expect.poll(() => sessions.current('bracket')?.status).toBe('working')
    await prompt()
    await prompt()
    expect(asked.map((a) => a.fresh)).toEqual([false, true, false])
  })

  it('refuses a body over 1 MB', async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    const url = http.url(`/hooks/${sessionId}/UserPromptSubmit`)
    const body = JSON.stringify({ prompt: 'x'.repeat(1024 * 1024) })
    expect((await fetch(url, { method: 'POST', body, headers: as(sessionId) })).status).toBe(413)
    expect(statuses.get(sessionId)).not.toContain('working')
    const under = JSON.stringify({ prompt: 'x'.repeat(1024 * 1024 - 100) })
    expect((await fetch(url, { method: 'POST', body: under, headers: as(sessionId) })).status).toBe(200)
  })

  it('listens on the loopback address only', () => {
    expect(http.url('/a')).toBe(`http://127.0.0.1:${http.port}/a`)
    expect(http.port).toBeGreaterThan(0)
  })

  // #113: another process of this machine can find the port and read the agent's command line, not its environment.
  it("is nothing to a request without this session's token in its header: 404, and the session is where it was", async () => {
    const { sessionId } = await sessions.start(object('bracket'), {})
    const other = await sessions.start(object('lid'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const token = tokenOf(sessionId)
    const url = http.url(`/hooks/${sessionId}/UserPromptSubmit`)
    const refused: Array<[string, Record<string, string>]> = [
      [url, {}],
      [url, { [SESSION_HEADER]: '' }],
      // What Claude Code would send should it not expand the token: the placeholder as torno wrote it.
      [url, { [SESSION_HEADER]: '$TORNO_SESSION' }],
      [url, { [SESSION_HEADER]: '${TORNO_SESSION}' }],
      [url, { [SESSION_HEADER]: 'A'.repeat(43) }],
      [url, { authorization: `Bearer ${token}` }],
      // Another session's token, of another object.
      [url, as(other.sessionId)],
      [`${url}?token=${token}`, {}],
      [http.url(`/hooks/${token}/${sessionId}/UserPromptSubmit`), {}]
    ]
    for (const [address, headers] of refused) {
      const reply = await fetch(address, { method: 'POST', body: '{"prompt":"hello"}', headers })
      expect([address, headers, reply.status, await reply.json()]).toEqual([address, headers, 404, { error: 'not found' }])
    }
    expect(statuses.get(sessionId)).toEqual(['starting', 'idle'])
    expect((await fetch(url, { method: 'POST', body: '{"prompt":"hello"}', headers: as(sessionId) })).status).toBe(200)
    expect(statuses.get(sessionId)?.at(-1)).toBe('working')
  })

  it('gives the token to the agent in its environment alone: not in its arguments, no file, no log; and lets it go with the session', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const filesOf = (dir: string): string[] => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
    // A router of its own: on the shared one the hooks are the first manager's.
    const http = recording(await startHttp())
    try {
      const made = new Sessions({ configDir, http, debug: true, adapter: claudeAdapter(`node ${FAKE}`), contextFor: () => ({ text: 'Build ok.', sentMarkIds: [] }), systemPromptFor: () => 'You are in torno.', mcpUrlFor: (id) => http.url(`/mcp/${id}`) })
      others.push(made)
      let all = ''
      made.on('data', (m) => (all += m.data))
      const obj = object('secret')
      const { sessionId } = await made.start(obj, {})
      await expect.poll(() => all).toMatch(READY_LINE)
      const token = tokenOf(sessionId)
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      // Its arguments, which `ps` shows every user, name the addresses and hold no token.
      const args: string[] = JSON.parse(/READY (\[.*\])/s.exec(all.replace(/\r?\n/g, ''))![1])
      for (const arg of args) expect(arg).not.toContain(token)
      const mcpFile = args[args.indexOf('--mcp-config') + 1]
      expect(mcpFile).toBe(join(configDir, `${sessionId}.mcp.json`))
      const mcp = JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers.torno
      expect(mcp).toEqual({ type: 'http', url: `http://127.0.0.1:${http.port}/mcp/${obj.id}`, headers: { [SESSION_HEADER]: '${TORNO_SESSION}' } })
      const hook = JSON.parse(args[args.indexOf('--settings') + 1]).hooks.Stop[0].hooks[0]
      expect(hook).toMatchObject({ url: `http://127.0.0.1:${http.port}/hooks/${sessionId}/Stop`, headers: { [SESSION_HEADER]: '$TORNO_SESSION' }, allowedEnvVars: ['TORNO_SESSION'] })
      // Its environment has it: the stand-in puts it in the header from there, as Claude Code does, and is let in.
      made.write(sessionId, 'hook Stop\r')
      await expect.poll(() => all).toContain('Stop: ok')
      // Nothing torno wrote holds it: no file of the object, not the file of the MCP server.
      for (const file of [...filesOf(obj.dir), ...filesOf(configDir)]) expect([file, readFileSync(file, 'utf8').includes(token)]).toEqual([file, false])
      // What is logged of the start names the arguments, and none holds the token.
      const lines = logged.mock.calls.map((call) => call.join(' '))
      expect(lines.some((line) => line.includes(`session ${sessionId}`) && line.includes('--mcp-config'))).toBe(true)
      for (const line of lines) expect(line).not.toContain(token)
      // Gone with the session: the token opens nothing, and the file is removed.
      await made.stop(sessionId)
      expect((await fetch(http.url(`/hooks/${sessionId}/Stop`), { method: 'POST', body: '{}', headers: as(sessionId) })).status).toBe(404)
      expect(existsSync(mcpFile)).toBe(false)
    } finally {
      logged.mockRestore()
      await http.close()
    }
  })

  it("sends the agent's tools the token from its environment, and nothing to an agent that did not expand it", async () => {
    const own = recording(await startHttp())
    const heard: Array<string | undefined> = []
    // Stands in for torno's MCP server: what a request carries is the router's to check, and it gets here only with the token.
    own.route('/mcp', async (req, res, rest) => {
      const body = JSON.parse(await readBody(req, 1024 * 1024)) as { id?: number; method: string }
      heard.push(rest[0])
      const result = body.method === 'tools/call' ? { content: [{ type: 'text', text: `served ${rest[0]}` }] } : { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'torno', version: '0' } }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result }))
    })
    const made = new Sessions({ configDir, http: own, adapter: claudeAdapter(`node ${FAKE}`), viewFor: () => 'chat', contextFor: () => ({ text: '', sentMarkIds: [] }), systemPromptFor: () => '', mcpUrlFor: (id) => own.url(`/mcp/${id}`) })
    let results: StreamMessage[] = []
    made.on('stream', (m) => m.message.type === 'user' && results.push(m.message))
    const toolText = (): string => JSON.stringify(results)
    try {
      const { sessionId } = await made.start(object('tooled'), {})
      void made.send(sessionId, { text: 'tool mcp__torno__scene {}' })
      await expect.poll(toolText).toContain('served tooled')
      expect(heard).toEqual(['tooled', 'tooled'])
      await made.stopAll()
      // A CLI that sent the placeholder as it is written gets 404: no tool of torno's answers it.
      process.env.FAKE_AGENT_NO_EXPAND = '1'
      results = []
      heard.length = 0
      const second = await made.start(object('tooled'), {})
      void made.send(second.sessionId, { text: 'tool mcp__torno__scene {}' })
      await expect.poll(toolText).toContain('not found')
      expect(heard).toEqual([])
    } finally {
      delete process.env.FAKE_AGENT_NO_EXPAND
      await made.stopAll()
      await own.close()
    }
  })
})

describe('killGroup', () => {
  it('kills the group of a process, and the process alone when the group is gone', () => {
    const killed: number[] = []
    killGroup(4242, (target) => void killed.push(target))
    expect(killed).toEqual([-4242])
    const gone: number[] = []
    killGroup(4242, (target) => {
      gone.push(target)
      if (target < 0) throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    expect(gone).toEqual([-4242, 4242])
  })

  it('kills nothing unless the pid is above 1: -0 is the caller\'s own group, -1 every process it may signal', () => {
    const killed: number[] = []
    for (const pid of [0, 1, -1, -4242, NaN, 1.5, Infinity]) killGroup(pid, (target) => void killed.push(target))
    expect(killed).toEqual([])
  })
})

// Claude Code started headless (view `chat`): the stand-in speaks the stream protocol (test/fake-agent.mjs), the
// hooks are posted to the real router as they are for a terminal.
describe('a chat session', () => {
  let count = 0
  // The hook endpoint answers for the first manager that mounts it on a router: this one has its own router and
  // manager, and each test says through `contextOf` what the prompts are answered with.
  let chatHttp: HttpRouter
  let chatSessions: Sessions
  let contextOf: (id: string, call: number) => { text: string; sentMarkIds: string[] }
  let calls = 0
  type Seen = {
    messages: StreamMessage[]
    data: string[]
    asks: Array<{ requestId: string; toolName: string; input: unknown; suggestions?: unknown[] }>
    asked: Array<{ requestId: string; answered: boolean }>
    contexts: Array<{ text: string; sentMarkIds: string[]; prompt?: string }>
    statuses: SessionStatus[]
  }
  const records = new Map<string, Seen>()
  const record = (sessionId: string): Seen => {
    let r = records.get(sessionId)
    if (!r) records.set(sessionId, (r = { messages: [], data: [], asks: [], asked: [], contexts: [], statuses: [] }))
    return r
  }
  const chatFresh: boolean[] = []
  const chatDelivered: Array<{ objectId: string; sentMarkIds: string[] }> = []

  beforeAll(async () => {
    chatHttp = recording(await startHttp())
    chatSessions = new Sessions({
      configDir,
      http: chatHttp,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: async (id, opts) => {
        chatFresh.push(opts.fresh)
        return contextOf(id, (calls += 1))
      },
      onDelivered: (objectId, sentMarkIds) => chatDelivered.push({ objectId, sentMarkIds }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => chatHttp.url(`/mcp/${id}`)
    })
    chatSessions.on('data', (m) => record(m.sessionId).data.push(m.data))
    chatSessions.on('stream', (m) => record(m.sessionId).messages.push(m.message))
    chatSessions.on('ask', (m) => record(m.sessionId).asks.push(m))
    chatSessions.on('asked', (m) => record(m.sessionId).asked.push(m))
    chatSessions.on('context', (m) => record(m.sessionId).contexts.push(m))
    chatSessions.on('status', (m) => record(m.sessionId).statuses.push(m.status))
  })

  afterEach(async () => {
    await chatSessions.stopAll()
    contextOf = (id, call) => ({ text: `context ${call} for ${id}`, sentMarkIds: [] })
    calls = 0
    chatDelivered.length = 0
    chatFresh.length = 0
  })

  afterAll(async () => {
    await chatHttp.close()
  })

  /** A chat session of the stand-in, in a folder of its own, with everything it says and is asked recorded. */
  async function chat(opts: { resume?: boolean; folder?: string; context?: typeof contextOf; model?: string; effort?: Effort } = {}) {
    count += 1
    contextOf = opts.context ?? ((id, call) => ({ text: `context ${call} for ${id}`, sentMarkIds: [] }))
    const obj = object(opts.folder ?? `chat-${count}`)
    const started = await chatSessions.start(obj, { resume: opts.resume, model: opts.model, effort: opts.effort })
    const r = record(started.sessionId)
    return {
      ...r,
      sessions: chatSessions,
      obj,
      started,
      sessionId: started.sessionId,
      send: (content: string) => chatSessions.prompt(started.sessionId, [{ type: 'text', text: content } satisfies PromptBlock]),
      types: () => r.messages.map((m) => m.type),
      results: () => r.messages.filter((m) => m.type === 'result'),
      /** The text of the tool results the agent was given. */
      toolResults: () =>
        r.messages
          .filter((m) => m.type === 'user')
          .flatMap((m) => ((m.message as { content: Array<{ type: string; content?: unknown }> }).content ?? []).filter((b) => b.type === 'tool_result').map((b) => b.content))
    }
  }

  it('starts headless: the stream, not a terminal, with the chat flags and the arguments of the terminal', async () => {
    const c = await chat()
    expect(c.started.view).toBe('chat')
    expect(c.sessions.current(c.obj.id)).toMatchObject({ view: 'chat' })
    c.send('say hello')
    await expect.poll(() => c.results().length).toBe(1)
    const init = c.messages.find((m) => m.type === 'system' && m.subtype === 'init')!
    const args = init.fake_argv as string[]
    expect(args.slice(args.indexOf('-p'), args.indexOf('-p') + 9)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio'])
    expect(args).toContain('--session-id')
    expect(args).toContain('--mcp-config')
    // What the CLI prints is the stream's, never the terminal's.
    expect(c.data).toEqual([])
    expect(c.sessions.current(c.obj.id)!.pid).toBeGreaterThan(1)
  })

  it('streams what the agent says, and ends a turn with a result', async () => {
    const c = await chat()
    c.send('say one two three')
    await expect.poll(() => c.results().length).toBe(1)
    const deltas = c.messages.filter((m) => m.type === 'stream_event').map((m) => (m.event as { delta?: { text?: string } }).delta?.text).filter(Boolean)
    expect(deltas).toEqual(['one ', 'two ', 'three'])
    const assistant = c.messages.find((m) => m.type === 'assistant')!
    expect((assistant.message as { content: unknown[] }).content).toEqual([{ type: 'text', text: 'one two three' }])
    expect(c.results()[0]).toMatchObject({ subtype: 'success', is_error: false })
  })

  it('tells the marks again in the prompt after a compaction of the stream, once', async () => {
    const c = await chat()
    c.send('say before')
    await expect.poll(() => c.results().length).toBe(1)
    c.send('/compact')
    await expect.poll(() => c.results().length).toBe(2)
    c.send('say after')
    await expect.poll(() => c.results().length).toBe(3)
    c.send('say later')
    await expect.poll(() => c.results().length).toBe(4)
    expect(chatFresh).toEqual([false, true, false])
  })

  it('keeps going past what it does not know: a line that is no JSON, an object of a type from the future', async () => {
    const c = await chat()
    c.send('garbage\nsay still here')
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.types()).toContain('from_the_future')
    expect(c.messages.some((m) => m.type === 'assistant')).toBe(true)
  })

  it('answers the prompt\'s hook with its context, says so with the prompt, and delivers the marks as for a terminal', async () => {
    const c = await chat({ context: () => ({ text: 'Marks: M4 at lid/F2.', sentMarkIds: ['M4'] }) })
    c.send('what is M4?')
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.contexts).toMatchObject([{ text: 'Marks: M4 at lid/F2.', sentMarkIds: ['M4'], prompt: 'what is M4?' }])
    // The context reached the agent: the stand-in says what its hook was answered with.
    expect(c.messages.find((m) => m.type === 'system' && m.subtype === 'hook_response')).toMatchObject({ output: 'Marks: M4 at lid/F2.' })
    expect(chatDelivered).toEqual([{ objectId: c.obj.id, sentMarkIds: ['M4'] }])
  })

  it('tells of the context of a terminal session too', async () => {
    const heard: Array<{ text: string; prompt?: string }> = []
    sessions.on('context', (m) => heard.push(m))
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    sessions.write(sessionId, 'hook\r')
    await expect.poll(() => said(sessionId)).toContain('context: context for bracket')
    expect(heard).toMatchObject([{ objectId: 'bracket', text: 'context for bracket', sentMarkIds: [], prompt: 'hello' }])
  })

  it('gives each of two prompts sent at once its own context, in order', async () => {
    const c = await chat({ context: (_id, call) => ({ text: `context ${call}`, sentMarkIds: [`M${call}`] }) })
    c.send('say first')
    c.send('say second')
    await expect.poll(() => c.results().length).toBe(2)
    expect(c.contexts.map((x) => [x.prompt, x.text, x.sentMarkIds])).toEqual([
      ['say first', 'context 1', ['M1']],
      ['say second', 'context 2', ['M2']]
    ])
  })

  it('goes from starting to idle (ready) to working to idle, by the hooks', async () => {
    const c = await chat()
    await expect.poll(() => c.sessions.history(c.sessionId)!.commands.length).toBeGreaterThan(0)
    expect(c.statuses).toEqual(['starting', 'idle'])
    c.send('say hi')
    await expect.poll(() => c.statuses.at(-1)).toBe('idle')
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.statuses).toEqual(['starting', 'idle', 'working', 'idle'])
  })

  it('says what the agent can do, from its initialize', async () => {
    const c = await chat()
    await expect.poll(() => c.sessions.history(c.sessionId)!.commands.length).toBeGreaterThan(0)
    const { commands, models } = c.sessions.history(c.sessionId)!
    expect(commands.map((x) => x.name)).toEqual(['compact', 'clear'])
    expect(commands[0]).toEqual({ name: 'compact', description: 'Compact the conversation', argumentHint: '' })
    expect(models).toEqual([{ value: 'default', displayName: 'Default', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, { value: 'haiku', displayName: 'Haiku', efforts: ['low', 'medium', 'high'] }])
    expect(c.sessions.history('no-such-session')).toBeUndefined()
  })

  it('needs input while a request of the agent waits, works once it is answered, and tells the agent the answer', async () => {
    const c = await chat()
    c.send('ask Bash {"command":"ls"}')
    await expect.poll(() => c.asks.length).toBe(1)
    expect(c.asks[0]).toMatchObject({ toolName: 'Bash', input: { command: 'ls' } })
    expect(c.asks[0].suggestions).toHaveLength(3)
    await expect.poll(() => c.statuses.at(-1)).toBe('needs_input')
    c.sessions.answer(c.sessionId, c.asks[0].requestId, { behavior: 'allow', updatedInput: { command: 'ls -la' } })
    expect(c.asked).toMatchObject([{ requestId: c.asks[0].requestId, answered: true }])
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.toolResults()).toEqual(['allowed: {"command":"ls -la"}'])
    expect(c.statuses).toContain('working')
    expect(c.statuses.at(-1)).toBe('idle')
    // Answered once: the same request again writes nothing and moves nothing.
    c.sessions.answer(c.sessionId, c.asks[0].requestId, { behavior: 'deny', message: 'late' })
    expect(c.asked).toHaveLength(1)
  })

  it('denies with the reason it is given', async () => {
    const c = await chat()
    c.send('ask Write {"file_path":"x"}')
    await expect.poll(() => c.asks.length).toBe(1)
    c.sessions.answer(c.sessionId, c.asks[0].requestId, { behavior: 'deny', message: 'not there' })
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.toolResults()).toEqual(['denied: not there'])
  })

  it('stays waiting until every open request is answered', async () => {
    const c = await chat()
    c.send('ask Bash {"a":1}\nask Read {"b":2}')
    await expect.poll(() => c.asks.length).toBe(1)
    c.sessions.answer(c.sessionId, c.asks[0].requestId, { behavior: 'allow', updatedInput: {} })
    await expect.poll(() => c.asks.length).toBe(2)
    await expect.poll(() => c.statuses.at(-1)).toBe('needs_input')
    c.sessions.answer(c.sessionId, c.asks[1].requestId, { behavior: 'allow', updatedInput: {} })
    await expect.poll(() => c.results().length).toBe(1)
  })

  it('interrupts a turn at once, and is idle after it, though the CLI posts no Stop for it', async () => {
    const c = await chat()
    c.send('slow 5')
    await expect.poll(() => c.statuses.at(-1)).toBe('working')
    await expect.poll(() => c.messages.some((m) => m.type === 'stream_event')).toBe(true)
    expect(await c.sessions.control(c.sessionId, { subtype: 'interrupt' })).toEqual({ still_queued: [] })
    // No clock: the turn was 5 s long, and the result is there because the interrupt cut it (poll's own 5 s bound is the limit).
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.results()[0]).toMatchObject({ subtype: 'error_during_execution', is_error: true })
    await expect.poll(() => c.statuses.at(-1)).toBe('idle')
  })

  it('keeps the prompts queued behind a turn through an interrupt: the CLI runs them after it, together, and torno says so', async () => {
    const c = await chat()
    c.send('slow 5')
    c.send('say banana')
    c.send('say cherry')
    await expect.poll(() => c.statuses.at(-1)).toBe('working')
    await expect.poll(() => c.messages.some((m) => m.type === 'stream_event')).toBe(true)
    await expect.poll(() => c.messages.filter((m) => m.type === 'command_lifecycle' && m.state === 'queued').length).toBe(2)
    const answer = (await c.sessions.control(c.sessionId, { subtype: 'interrupt' })) as { still_queued: string[] }
    expect(answer.still_queued).toHaveLength(2)
    await expect.poll(() => c.results().length, { timeout: 5000 }).toBe(2)
    const items = () => c.sessions.history(c.sessionId)!.items
    // One init for both, and both answered in the one turn.
    expect(c.messages.filter((m) => m.type === 'system' && m.subtype === 'init')).toHaveLength(2)
    expect(items().filter((i) => i.kind === 'user').map((i) => (i as { state: string }).state)).toEqual(['sent', 'sent', 'sent'])
    expect(items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toContain('banana')
    expect(items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toContain('cherry')
    await expect.poll(() => c.statuses.at(-1)).toBe('idle')
    // The CLI says `completed` after the turn's `result`, on lines of their own: they may come in a later read of
    // the pipe than the result, and the idle came before both (from the Stop hook).
    await expect.poll(() => c.messages.filter((m) => m.type === 'command_lifecycle' && m.state === 'completed').length).toBe(3)
  })

  it('is idle after a prompt that is no turn, followed by one that is: no result is waited for', async () => {
    const c = await chat()
    c.send('/noop')
    await expect.poll(() => c.messages.filter((m) => m.type === 'system').length).toBe(1)
    c.send('say real')
    await expect.poll(() => c.results().length).toBe(1)
    await expect.poll(() => c.statuses.at(-1)).toBe('idle')
    // And a third turn still ends in idle.
    c.send('say again')
    await expect.poll(() => c.results().length).toBe(2)
    await expect.poll(() => c.statuses.at(-1)).toBe('idle')
  })

  it('interrupts a busy session before it ends it: the turn it was in ends with its own result, which a SIGTERM would have cut off', async () => {
    const c = await chat()
    c.send('slow 10')
    await expect.poll(() => c.messages.some((m) => m.type === 'stream_event')).toBe(true)
    await c.sessions.stop(c.sessionId)
    // No clock: the stand-in prints a result for the turn only when it was interrupted; killed it prints none.
    expect(c.results()).toMatchObject([{ subtype: 'error_during_execution' }])
    expect(c.statuses.at(-1)).toBe('exited')
  })

  it('starts on the model and effort chosen for the session, and says the effort', async () => {
    const c = await chat({ model: 'haiku', effort: 'high' })
    c.send('say hi')
    await expect.poll(() => c.results().length).toBe(1)
    const init = c.messages.find((m) => m.type === 'system' && m.subtype === 'init')!
    expect(init.fake_argv).toEqual(expect.arrayContaining(['--model=haiku', '--effort=high']))
    expect(init).toMatchObject({ model: 'haiku' })
    expect(c.sessions.history(c.sessionId)!.meta.effort).toBe('high')
  })

  it('sets the effort of the session through a control request, for the session alone, and refuses one the CLI does not take', async () => {
    const c = await chat()
    expect(c.sessions.history(c.sessionId)!.meta.effort).toBeUndefined()
    await c.sessions.setEffort(c.sessionId, 'max')
    expect(c.sessions.history(c.sessionId)!.meta.effort).toBe('max')
    expect(c.sessions.history(c.sessionId)!.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'note', text: 'Effort: max' })]))
    c.send('say hi')
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.messages.find((m) => m.type === 'system' && m.subtype === 'init')).toMatchObject({ effort: 'max' })
    await expect(c.sessions.setEffort(c.sessionId, 'loud' as Effort)).rejects.toThrow(/effortLevel/)
    expect(c.sessions.history(c.sessionId)!.meta.effort).toBe('max')
  })

  it('sets the permission mode of the session through a control request, and the next init reports it', async () => {
    const c = await chat()
    await c.sessions.setMode(c.sessionId, 'acceptEdits')
    expect(c.sessions.history(c.sessionId)!.meta.permissionMode).toBe('acceptEdits')
    c.send('say hi')
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.messages.find((m) => m.type === 'system' && m.subtype === 'init')).toMatchObject({ permissionMode: 'acceptEdits' })
    await expect(c.sessions.setMode(c.sessionId, 'loud' as Mode)).rejects.toThrow(/unknown mode/)
    expect(c.sessions.history(c.sessionId)!.meta.permissionMode).toBe('acceptEdits')
  })

  it('sets the model of the session through a control request', async () => {
    const c = await chat()
    expect(await c.sessions.control(c.sessionId, { subtype: 'set_model', model: 'haiku' })).toEqual({})
    c.send('say hi')
    await expect.poll(() => c.results().length).toBe(1)
    expect(c.messages.find((m) => m.type === 'system' && m.subtype === 'init')).toMatchObject({ model: 'haiku' })
  })

  it('writes nothing to a chat session by the terminal calls, and a chat call to a terminal session does nothing', async () => {
    const c = await chat()
    c.sessions.write(c.sessionId, 'say typed\r')
    c.sessions.insert(c.sessionId, 'say pasted')
    c.sessions.resize(c.sessionId, 100, 40)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(c.messages).toEqual([])
    expect(c.data).toEqual([])
    // A terminal session takes none of the chat calls.
    const { sessionId } = await sessions.start(object('bracket'), {})
    await expect.poll(() => said(sessionId)).toMatch(READY_LINE)
    const before = said(sessionId)
    sessions.prompt(sessionId, [{ type: 'text', text: 'hello' }])
    sessions.answer(sessionId, 'r1', { behavior: 'allow', updatedInput: {} })
    await expect(sessions.control(sessionId, { subtype: 'interrupt' })).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(said(sessionId)).toBe(before)
  })

  it('stops: its stdin ends, it leaves, and the status is exited', async () => {
    const c = await chat()
    const pid = c.sessions.current(c.obj.id)!.pid
    expect(alive(pid)).toBe(true)
    await c.sessions.stop(c.sessionId)
    expect(alive(pid)).toBe(false)
    expect(c.statuses.at(-1)).toBe('exited')
    expect(c.sessions.current(c.obj.id)).toBeNull()
    // Nothing is sent to it any more.
    c.send('say late')
    expect(c.messages.filter((m) => m.type === 'result')).toEqual([])
    await c.sessions.stop(c.sessionId)
  })

  it('gives up what was waiting when it ends: the request is not answered, and says so', async () => {
    const c = await chat()
    c.send('ask Bash {"command":"ls"}')
    await expect.poll(() => c.asks.length).toBe(1)
    await c.sessions.stop(c.sessionId)
    // The stand-in leaves when its stdin ends, whatever it waits for.
    expect(c.asked).toMatchObject([{ requestId: c.asks[0].requestId, answered: false }])
    expect(c.statuses.at(-1)).toBe('exited')
  })

  it('kills an agent that will not leave: SIGTERM to its group after two seconds, SIGKILL after four', async () => {
    process.env.FAKE_AGENT_STUBBORN = '1'
    try {
      const c = await chat()
      await expect.poll(() => c.sessions.history(c.sessionId)!.commands.length).toBeGreaterThan(0)
      const pid = c.sessions.current(c.obj.id)!.pid
      const began = Date.now()
      await c.sessions.stop(c.sessionId)
      expect(Date.now() - began).toBeGreaterThanOrEqual(3900)
      expect(alive(pid)).toBe(false)
    } finally {
      delete process.env.FAKE_AGENT_STUBBORN
    }
  }, 20_000)

  it('has its conversation on file from the hooks, and resumes it with --resume', async () => {
    const first = await chat({ folder: 'chat-resume' })
    first.send('say hi')
    await expect.poll(() => first.results().length).toBe(1)
    const file = sessionFile('chat-resume')
    expect(file.conversationId).toMatch(UUID)
    await first.sessions.stop(first.sessionId)
    expect(first.sessions.resumable(first.obj)).toBe(true)

    const second = await chat({ folder: 'chat-resume', resume: true })
    second.send('say again')
    await expect.poll(() => second.results().length).toBe(1)
    const args = second.messages.find((m) => m.type === 'system' && m.subtype === 'init')!.fake_argv as string[]
    expect(args[args.indexOf('--resume') + 1]).toBe(file.conversationId)
    expect(args).not.toContain('--session-id')
  })

  it('is exited when the agent goes by itself, and stays one session of its object', async () => {
    const c = await chat()
    expect(await c.sessions.start(c.obj, {})).toMatchObject({ sessionId: c.sessionId, view: 'chat' })
    await c.sessions.stop(c.sessionId)
    expect(c.statuses.at(-1)).toBe('exited')
  })

  it('starts in the view chosen for the object', async () => {
    views.set('chosen-terminal', 'terminal')
    views.set('chosen-chat', 'chat')
    expect((await sessions.start(object('chosen-terminal'), {})).view).toBe('terminal')
    expect((await sessions.start(object('chosen-chat'), {})).view).toBe('chat')
  })
})

// A 4 x 4 PNG, red: what the window is stubbed to answer the picture of the viewport with.
const PNG_4X4 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP4z8DwHxkzkC4AADxAH+HggXe0AAAAAElFTkSuQmCC', 'base64')

describe('the transcript of a chat session', () => {
  let count = 0
  let tHttp: HttpRouter
  let tSessions: Sessions
  let marks: string[] = []
  /** The marks the hook is answered with for the 1st, 2nd, … prompt; `marks` for any after them. */
  let marksPerCall: string[][] = []
  let hooks = 0
  let handedOver: (() => void) | undefined
  /** The folder whose notices for the next prompt (`takeNotices`) the hook tells, as `index.ts` does. */
  let noticesOf: string | undefined
  let picture: ((obj: ObjectInfo) => Promise<Uint8Array>) | undefined
  let attacher: ((objectId: string, ids: string[] | 'all') => Promise<BoardAttachment>) | undefined
  /** The draft view notes the project has, in mark order. */
  let drafted: NoteMark[] = []
  const told: Array<{ sessionId: string; item: ChatItem; seq: number }> = []
  const metas: Array<{ sessionId: string; meta: ChatMeta; seq: number }> = []
  const abilities: Array<{ sessionId: string; objectId: string; commands: Array<{ name: string }>; models: unknown[]; seq: number }> = []
  const delivered2: string[][] = []
  /** What the board line told, as `onDelivered` was given it; and what the hook is to answer with. */
  const deliveredBoard: Array<Record<string, string> | undefined> = []
  const deliveredTracings: Array<Record<string, string> | undefined> = []
  let boardTold: Record<string, string> | undefined
  let tracingsTold: Record<string, string> | undefined
  let boardCounts: { total: number; new: number } | undefined
  const givenUp: string[] = []

  beforeAll(async () => {
    tHttp = recording(await startHttp())
    tSessions = new Sessions({
      configDir,
      http: tHttp,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: async () => {
        if (noticesOf !== undefined) {
          const notice = await takeNotices(noticesOf)
          return { text: notice?.text ?? '', sentMarkIds: [], ...(notice ? { delivered: notice.done } : {}) }
        }
        const ids = marksPerCall[hooks++] ?? marks
        return { text: tracingsTold ? 'tracings: T1 (new to you). Read them with tracings.' : boardTold ? 'Board: 1 card (1 new: C1 text). Read it with board.' : ids.length > 0 ? `Marks: ${ids.join(' ')}` : handedOver ? 'A notice of main\'s' : '', sentMarkIds: ids, ...(handedOver ? { delivered: handedOver } : {}), ...(boardTold ? { boardTold } : {}), ...(tracingsTold ? { tracingsTold } : {}), ...(boardTold && boardCounts ? { board: boardCounts } : {}) }
      },
      onDelivered: (_id, ids, told, tracingsKept) => {
        delivered2.push(ids)
        deliveredBoard.push(told)
        deliveredTracings.push(tracingsKept)
      },
      systemPromptFor: () => '',
      mcpUrlFor: (id) => tHttp.url(`/mcp/${id}`),
      picture: (obj) => (picture ? picture(obj) : Promise.reject(new Error('no window'))),
      attachBoard: (objectId, ids) => (attacher ? attacher(objectId, ids) : Promise.reject(new Error('no board'))),
      draftNotes: async () => drafted
    })
    tSessions.on('item', (m) => told.push({ sessionId: m.sessionId, item: m.item, seq: m.seq }))
    tSessions.on('meta', (m) => metas.push({ sessionId: m.sessionId, meta: m.meta, seq: m.seq }))
    tSessions.on('capabilities', (m) => abilities.push(m))
    tSessions.on('asked', (m) => !m.answered && givenUp.push(m.requestId))
  })
  afterEach(async () => {
    await tSessions.stopAll()
    marks = []
    marksPerCall = []
    hooks = 0
    handedOver = undefined
    noticesOf = undefined
    picture = undefined
    attacher = undefined
    drafted = []
    told.length = 0
    metas.length = 0
    abilities.length = 0
    givenUp.length = 0
    delivered2.length = 0
    deliveredBoard.length = 0
    deliveredTracings.length = 0
    boardTold = undefined
    tracingsTold = undefined
    boardCounts = undefined
  })
  afterAll(async () => {
    await tHttp.close()
  })

  async function start(opts: { folder?: string; resume?: boolean } = {}) {
    count += 1
    const obj = object(opts.folder ?? `transcript-${count}`)
    const started = await tSessions.start(obj, { resume: opts.resume })
    const id = started.sessionId
    const items = (): ChatItem[] => tSessions.history(id)!.items
    return {
      obj,
      id,
      items,
      kinds: () => items().map((i) => i.kind),
      send: (text: string, extra: { attachView?: boolean; attachedView?: Uint8Array; board?: BoardAttach } = {}) => tSessions.send(id, { text, ...extra }),
      turns: () => items().filter((i) => i.kind === 'turn').length,
      logFile: () => {
        const folder = join(obj.dir, '.torno', 'chat')
        return existsSync(folder) ? readdirSync(folder).map((f) => join(folder, f)) : []
      }
    }
  }
  const lines = (file: string): ChatItem[] => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as ChatItem)

  it('is the prompt, what torno added to it, the tool, the reply and the end of the turn', async () => {
    marks = ['M4', 'M5']
    const c = await start()
    await c.send('tool Bash {"command":"ls"}\nsay all done')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.kinds()).toEqual(['user', 'context', 'tool', 'text', 'turn'])
    const [user, context, tool, text, turn] = c.items()
    expect(user).toMatchObject({ kind: 'user', text: 'tool Bash {"command":"ls"}\nsay all done', state: 'sent' })
    // The marks the hook was answered with, under the prompt they went with, and the marks `onDelivered` was given.
    expect(context).toMatchObject({ kind: 'context', forUser: user.id, text: 'Marks: M4 M5', marks: ['M4', 'M5'] })
    expect(delivered2).toEqual([['M4', 'M5']])
    expect(tool).toMatchObject({ kind: 'tool', name: 'Bash', state: 'done', result: 'ran Bash', input: { command: 'ls' } })
    expect(text).toMatchObject({ kind: 'text', text: 'all done', streaming: false })
    expect(turn).toMatchObject({ kind: 'turn', ok: true, stopped: false })
    expect(tSessions.history(c.id)!.meta).toMatchObject({ model: 'fake-model', tornoConnected: true })
    expect(tSessions.history(c.id)!.earlier).toEqual([])
  })

  it('lists a prompt that built nothing as soon as it is told sent, though its log line is still being written (#313)', async () => {
    const c = await start()
    const asked: Array<Promise<string[]>> = []
    tSessions.on('item', (m) => {
      if (m.item.kind === 'user' && m.item.state === 'sent') asked.push(tSessions.prompts(c.obj).then((rows) => rows.map((r) => r.text)))
    })
    await c.send('say nothing was built')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(asked).toHaveLength(1)
    expect(await asked[0]).toEqual(['say nothing was built'])
  })

  it('gives main what the board line told once the answer has left, with no marks to send', async () => {
    boardTold = { C1: 'abc' }
    const c = await start()
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(delivered2).toEqual([[]])
    expect(deliveredBoard).toEqual([{ C1: 'abc' }])
  })

  it('gives main what the tracings line told once the answer has left, with no marks to send', async () => {
    tracingsTold = { T1: 'abc.def' }
    const c = await start()
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(delivered2).toEqual([[]])
    expect(deliveredTracings).toEqual([{ T1: 'abc.def' }])
  })

  it('tells main the answer was handed over, for what is kept until then (a Go back\'s notice), once it has left and not before', async () => {
    const seen = vi.fn()
    handedOver = seen
    const c = await start()
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'context')).toMatchObject({ text: 'A notice of main\'s' })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('tells Claude of a rename of a part with the next prompt, once', async () => {
    const c = await start()
    await keepRenameNotice(c.obj.dir, { from: 'shell', to: 'front case', files: ['model.py'], at: new Date().toISOString() })
    noticesOf = c.obj.dir
    await c.send('say first')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    const said = 'The person renamed the part shell to front case in model.py; keep the new name.'
    expect(c.items().filter((i) => i.kind === 'context')).toMatchObject([{ text: said }])
    await expect.poll(() => existsSync(join(c.obj.dir, '.torno', 'renamed.json')), { timeout: 5000 }).toBe(false)
    await c.send('say second')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    expect(c.items().filter((i) => i.kind === 'context' && i.text.includes('renamed'))).toHaveLength(1)
  })

  it('keeps what a turn changed in the .py files of the folder, in memory, and tells it by the id of the turn', async () => {
    const c = await start()
    writeFileSync(join(c.obj.dir, 'part.py'), 'W = 1\nH = 5\n')
    writeFileSync(join(c.obj.dir, 'notes.md'), 'W = 1\n')
    await c.send('say first')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    const quiet = c.items().find((i) => i.kind === 'turn')!
    expect(await tSessions.changesOf(c.id, quiet.id)).toBeUndefined()
    // The person saves between the turns: not the next turn's.
    writeFileSync(join(c.obj.dir, 'part.py'), 'W = 1\nH = 6\n')
    await c.send('edit part.py "W = 1" "W = 2"\nsay done')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    const turn = c.items().filter((i) => i.kind === 'turn')[1]
    const changes = await tSessions.changesOf(c.id, turn.id)
    expect(changes).toEqual({ files: [{ file: 'part.py', before: 'W = 1\nH = 6\n', after: 'W = 2\nH = 6\n' }] })
    // Nothing of it in the log, which is text of the chat only.
    for (const file of c.logFile()) expect(readFileSync(file, 'utf8')).not.toContain('H = 6')
    expect(await tSessions.changesOf(c.id, 'no-such-turn')).toBeUndefined()
  })

  it('asks the agent to undo the last turn with a prompt of torno\'s own, after a note, and writes nothing itself', async () => {
    const c = await start()
    writeFileSync(join(c.obj.dir, 'part.py'), 'W = 1\nH = 5\n')
    await c.send('edit part.py "W = 1" "W = 2"\nsay done')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    const turn = c.items().find((i) => i.kind === 'turn')!
    // Only the last turn, and one main holds the changes of.
    await expect(tSessions.undoTurn(c.id, 'no-such-turn')).rejects.toThrow('Only the last turn can be undone')
    await tSessions.undoTurn(c.id, turn.id)
    // The stand-in only plays the words it knows: the file is as the turn left it, because torno wrote nothing.
    expect(readFileSync(join(c.obj.dir, 'part.py'), 'utf8')).toBe('W = 2\nH = 5\n')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    const items = c.items()
    const note = items.find((i) => i.kind === 'note' && i.text.startsWith('Undo:'))
    expect(note).toMatchObject({ tone: 'quiet' })
    expect((note as { text: string }).text).toContain('part.py')
    const asked = items.filter((i) => i.kind === 'user')[1] as { text: string }
    expect(asked.text).toContain('Undo your last turn')
    expect(asked.text).toContain('part.py, from line 1:\n- W = 2\n+ W = 1\n  H = 5')
    expect(items.indexOf(note!)).toBeLessThan(items.indexOf(asked as ChatItem))
    // The first turn is no longer the last, and a turn that changed nothing has nothing to undo.
    await expect(tSessions.undoTurn(c.id, turn.id)).rejects.toThrow('Only the last turn can be undone')
    const last = c.items().filter((i) => i.kind === 'turn')[1]
    await expect(tSessions.undoTurn(c.id, last.id)).rejects.toThrow('Nothing is kept of what that turn changed')
  })

  it('does not leave a queued command that is no turn queued, and puts a prompt that begins after the one at work', async () => {
    const c = await start()
    await c.send('slow 0.5')
    await c.send('/noop')
    await c.send('say after')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    await expect.poll(() => tSessions.history(c.id)!.items.filter((i) => i.kind === 'user').every((i) => (i as { state: string }).state === 'sent')).toBe(true)
    const kinds = c.items().map((i) => (i.kind === 'user' ? (i as { text: string }).text : i.kind))
    expect(kinds.indexOf('say after')).toBeGreaterThan(kinds.indexOf('turn'))
  })

  it('shows no context under a prompt that nothing was added to', async () => {
    const c = await start()
    await c.send('say plain')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.kinds()).toEqual(['user', 'text', 'turn'])
  })

  it('puts the context of two prompts sent at once under their own, and the second is queued until the CLI takes it up', async () => {
    const c = await start()
    marksPerCall = [['M1'], ['M2']]
    await c.send('slow 1')
    await c.send('say second')
    expect(c.items().filter((i) => i.kind === 'user').map((i) => (i as { state: string }).state)).toEqual(['sent', 'queued'])
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    const users = c.items().filter((i) => i.kind === 'user')
    expect(users.map((i) => (i as { state: string }).state)).toEqual(['sent', 'sent'])
    expect(c.items().filter((i) => i.kind === 'context')).toMatchObject([
      { forUser: users[0].id, marks: ['M1'] },
      { forUser: users[1].id, marks: ['M2'] }
    ])
  })

  it('shows every item once if it is asked for mid-stream, and what is told after it carries on from there', async () => {
    const c = await start()
    await c.send('slow 1.5\nsay the end')
    await expect.poll(() => c.items().some((i) => i.kind === 'text' && i.streaming)).toBe(true)
    const history = tSessions.history(c.id)!
    const shown = new Map(history.items.map((i) => [i.id, i]))
    expect(shown.size).toBe(history.items.length)
    // The window keeps what came after the snapshot, and only that.
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    const after = told.filter((m) => m.sessionId === c.id && m.seq > history.seq)
    expect(after.length).toBeGreaterThan(0)
    for (const m of after) shown.set(m.item.id, m.item)
    const final = c.items()
    expect([...shown.keys()]).toEqual(final.map((i) => i.id))
    expect([...shown.values()]).toEqual(final)
    // Sequence numbers only grow.
    const seqs = told.filter((m) => m.sessionId === c.id).map((m) => m.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })

  it('writes each item to the conversation\'s file when it is final, with no picture data and no address', async () => {
    const c = await start()
    // What a tool's input or output might hold of the session's environment.
    const secret = tokenOf(c.id)
    await c.send(`tool Bash {"command":"echo ${secret}"}\nsay logged`)
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    await tSessions.stop(c.id)
    const [file] = c.logFile()
    expect(file).toMatch(new RegExp(`${UUID.source.slice(1, -1)}\\.jsonl$`))
    const logged = lines(file)
    expect(logged.map((i) => i.kind)).toEqual(['user', 'tool', 'text', 'turn', 'note'])
    // What the turn took is in its line of the log (#127).
    expect(logged[3]).toMatchObject({ seconds: expect.any(Number), usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0, requests: 1, costUsd: 0, sessionCostUsd: 0 } })
    expect(logged.every((i) => i.kind !== 'thinking')).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain(secret)
    expect(JSON.stringify(tSessions.history(c.id)!.items)).not.toContain(secret)
    expect(readFileSync(join(c.obj.dir, '.torno', '.gitignore'), 'utf8')).toContain('chat/')
  })

  it('does not write the item that is still going on', async () => {
    const c = await start()
    await c.send('slow 2')
    await expect.poll(() => c.items().some((i) => i.kind === 'text' && i.streaming)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const [file] = c.logFile()
    expect(lines(file).map((i) => i.kind)).toEqual(['user'])
  })

  it('gives a resumed conversation what was logged of it as the earlier part, and a fresh one nothing', async () => {
    const first = await start({ folder: 'transcript-resume' })
    await first.send('say before')
    await expect.poll(() => first.turns(), { timeout: 5000 }).toBe(1)
    await tSessions.stop(first.id)

    const second = await start({ folder: 'transcript-resume', resume: true })
    const { earlier, items } = tSessions.history(second.id)!
    expect(items).toEqual([])
    expect(earlier.map((i) => i.kind)).toEqual(['user', 'text', 'turn', 'note', 'note'])
    expect(earlier[0]).toMatchObject({ text: 'say before' })
    expect(earlier.at(-1)).toMatchObject({ kind: 'note', tone: 'quiet' })
    expect((earlier.at(-1) as { text: string }).text).toMatch(/terminal/)
    // What this session says is logged in the same file, and read as earlier by the next.
    await second.send('say after')
    await expect.poll(() => second.turns(), { timeout: 5000 }).toBe(1)
    // Resumed: the CLI's running total may hold what the first process spent, so this turn claims no cost of its own.
    const resumed = second.items().find((i) => i.kind === 'turn') as Extract<ChatItem, { kind: 'turn' }>
    expect(resumed.usage).toMatchObject({ input: 1, sessionCostUsd: 0 })
    expect(resumed.usage).not.toHaveProperty('costUsd')
    await tSessions.stop(second.id)
    expect(second.logFile()).toHaveLength(1)
    const third = await start({ folder: 'transcript-resume', resume: true })
    expect(tSessions.history(third.id)!.earlier.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text)).toEqual(['say before', 'say after'])
  })

  it('stays readable when the session has ended, until another starts in that object', async () => {
    const c = await start({ folder: 'transcript-ended' })
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    await tSessions.stop(c.id)
    const ended = tSessions.history(c.id)!
    expect(ended.items.at(-1)).toMatchObject({ kind: 'note', text: 'The session ended' })
    expect(tSessions.chatOf(c.id)).toMatchObject({ id: 'transcript-ended' })
    const next = await start({ folder: 'transcript-ended' })
    expect(tSessions.history(c.id)).toBeUndefined()
    expect(tSessions.chatOf(c.id)).toBeUndefined()
    expect(tSessions.history(next.id)!.items).toEqual([])
  })

  it('adds a picture of the viewport to the prompt when asked, and shows it with the prompt', async () => {
    const c = await start()
    const seen: string[] = []
    picture = async (obj) => {
      seen.push(obj.id)
      return PNG_4X4
    }
    await c.send('say with a view', { attachView: true })
    expect(seen).toEqual([c.obj.id])
    const user = c.items()[0]
    expect(user).toMatchObject({ kind: 'user', text: 'say with a view' })
    const image = (user as { images: Array<{ mediaType: string; data?: string; width?: number; height?: number }> }).images[0]
    expect(image).toMatchObject({ mediaType: 'image/png', width: 4, height: 4 })
    expect(Buffer.from(image.data!, 'base64').equals(PNG_4X4)).toBe(true)
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
  })

  it('sends the picture the person was shown, not a fresh one, and checks it like any picture for the agent', async () => {
    const c = await start()
    const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    // The view has moved since: a picture made now would be another one.
    picture = async () => {
      throw new Error('a fresh picture was asked for')
    }
    await c.send('images', { attachedView: new Uint8Array(PNG_1X1) })
    const image = (c.items()[0] as { images: Array<{ mediaType: string; data?: string; width?: number; height?: number }> }).images[0]
    expect(image).toMatchObject({ mediaType: 'image/png', width: 1, height: 1 })
    expect(Buffer.from(image.data!, 'base64').equals(PNG_1X1)).toBe(true)
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toContain('images: 1 1x1')
    // Anything that is no picture the agent may be given is refused, sending nothing.
    const before = c.items().length
    await expect(c.send('say nothing', { attachedView: new Uint8Array([1, 2, 3]) })).rejects.toThrow('The picture of the view is not a PNG or a JPEG')
    expect(c.items()).toHaveLength(before)
  })

  it('sends nothing, and says why, when the picture cannot be made', async () => {
    const c = await start()
    picture = () => Promise.reject(new Error('the window shows another object'))
    await expect(c.send('say nothing', { attachView: true })).rejects.toThrow('the window shows another object')
    expect(c.items()).toEqual([])
    await expect(tSessions.send('nope', { text: 'x' })).rejects.toThrow()
  })

  /** A board in the folder of the session's object, and what is attached from it as main does. */
  function boardOf(c: { obj: ObjectInfo }): BoardStore {
    const store = new BoardStore({ dirOf: () => c.obj.dir })
    attacher = (objectId, ids) => attachBoard({ board: { read: (o) => store.read(o), live: async () => ({ marks: new Map() }) }, dirOf: () => c.obj.dir }, objectId, ids)
    return store
  }

  it('sends the part of the board that was attached after the prompt: its words, then its pictures; the prompt shows the person\'s words, the counts and the pictures', async () => {
    const c = await start()
    const store = boardOf(c)
    const frame = (await store.person(c.obj.id, { op: 'add', card: { kind: 'frame', name: 'Latch', x: 0, y: 0, w: 900, h: 500 } })).cards[0].id
    await store.person(c.obj.id, { op: 'add', card: { kind: 'text', text: 'wall 2 mm', x: 20, y: 40, w: 200, h: 100, frame } })
    const picture = await savePicture(c.obj.dir, new Uint8Array(PNG_4X4))
    const picked = (await store.person(c.obj.id, { op: 'add', card: { kind: 'picture', picture, caption: 'the old latch', x: 300, y: 40, w: 200, h: 100, frame } })).cards.at(-1)!.id
    await store.person(c.obj.id, { op: 'add', card: { kind: 'text', text: 'not attached', x: 5000, y: 5000, w: 200, h: 100 } })
    await c.send('images', { board: { ids: [frame] } })
    const user = c.items()[0] as { text: string; images: Array<{ width?: number }>; board?: unknown }
    expect(user.text).toBe('images')
    expect(user.images).toEqual([expect.objectContaining({ width: 4 })])
    expect(user.board).toEqual({ cards: 2, arrows: 0, frames: ['Latch'] })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    const said = c.items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)
    expect(said).toContain('images: 1 4x4')
    expect(said.some((t) => t.startsWith('Attached from the board by the person (Latch, 2 cards)'))).toBe(true)
    expect(said).toContain('wall 2 mm')
    expect(said).toContain(`[picture ${picked}: the old latch]`)
    expect(said.join('\n')).not.toContain('not attached')
  })

  it('names a card that was removed since it was attached, and sends the rest', async () => {
    const c = await start()
    const store = boardOf(c)
    const kept = (await store.person(c.obj.id, { op: 'add', card: { kind: 'text', text: 'wall 2 mm', x: 0, y: 0, w: 200, h: 100 } })).cards[0].id
    await c.send('say hi', { board: { ids: [kept, 'C9'] } })
    expect((c.items()[0] as { board?: unknown }).board).toEqual({ cards: 1, arrows: 0, frames: [], gone: ['C9'] })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text).join('\n')).toContain('C9 was removed from the board')
  })

  it('sends nothing, and says why, when the board cannot be read; and sends no board unless asked', async () => {
    const c = await start()
    attacher = () => Promise.reject(new Error('the board cannot be read'))
    await expect(c.send('say nothing', { board: { ids: 'all' } })).rejects.toThrow('the board cannot be read')
    expect(c.items()).toEqual([])
    await c.send('say plain')
    expect((c.items()[0] as { board?: unknown }).board).toBeUndefined()
  })

  it('keeps what the board line said on the context item, as numbers', async () => {
    boardTold = { C1: 'abc' }
    boardCounts = { total: 12, new: 2 }
    const c = await start()
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'context')).toMatchObject({ board: { total: 12, new: 2 } })
  })

  it('keeps nothing of the board but counts, words of main\'s own and names, in its log', async () => {
    const c = await start()
    const store = boardOf(c)
    await store.person(c.obj.id, { op: 'add', card: { kind: 'text', text: 'SECRET WORDS', x: 0, y: 0, w: 200, h: 100 } })
    await c.send('say hi', { board: { ids: 'all' } })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    await tSessions.stop(c.id)
    const [file] = c.logFile()
    expect(JSON.stringify(lines(file)[0])).not.toContain('SECRET WORDS')
    expect(lines(file)[0]).toMatchObject({ kind: 'user', text: 'say hi', board: { cards: 1, arrows: 0, frames: [] } })
  })

  /** A draft view note of the project of `c`, its pictures written as main writes them (a PNG of the size; `files: false` leaves them out). */
  async function noteOf(c: { obj: ObjectInfo }, id: string, references: number, ink = { w: 800, h: 600 }, files = true): Promise<NoteMark> {
    const write = async (kind: 'plain' | 'ink' | 'reference', bytes: Uint8Array): Promise<string> => (files ? writeNoteFile(c.obj.dir, kind, bytes, 'image/png') : `${kind === 'reference' ? 'r' : 'n'}-ffffffffffff.${kind === 'ink' ? 'ink.' : ''}png`)
    const refs = []
    for (let i = 0; i < references; i++) refs.push({ file: await write('reference', notePng(300 + i, 200)), comment: `ref ${i + 1}` })
    return {
      id, kind: 'note', author: 'user', note: `comment of ${id}`, status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1,
      camera: { position: [10, -10, 10], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }, createdAt: '2026-11-16T10:00:00.000Z', checkedRevision: 1,
      picture: await write('plain', notePng(ink.w, ink.h)), ink: await write('ink', notePng(ink.w, ink.h)), size: ink, strokes: [{ width: 4, points: [[1, 1], [3, 3]] }], inkColour: '#B5127A', labels: [],
      under: [{ box: [0, 0, 3, 3], refs: [{ ref: 'a/F1', descriptor: 'plane, normal +Z' }], cuts: [], scans: [], bare: true }], references: refs
    } as NoteMark
  }
  const said = (c: { items: () => ChatItem[] }): string[] => c.items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)

  it('carries the draft view notes with the prompt: the attached view, then each note\'s words, its inked picture and its references, in the order of the marks', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 1, { w: 800, h: 600 }), await noteOf(c, 'M3', 0, { w: 640, h: 480 })]
    await c.send('images', { attachedView: new Uint8Array(PNG_4X4) })
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    // The stand-in says the sizes of the pictures in the order they came, and each line of the words of a note.
    expect(said(c)).toContain('images: 4 4x4 800x600 300x200 640x480')
    expect(said(c).some((t) => t.startsWith('M1 · view note · draft: "comment of M1"'))).toBe(true)
    expect(said(c).some((t) => t.startsWith('M3 · view note · draft: "comment of M3"'))).toBe(true)
    expect(said(c)).toContain('- stroke 1, x 0–3, y 0–3: a/F1 (plane, normal +Z); partly over no part')
    expect(said(c)).toContain('reference 1: ref 1')
    // What the ink lies over stays on the item as data, one for each note; the words are not its text.
    const user = c.items()[0] as { text: string; images: unknown[]; notes?: unknown[]; drawing?: unknown }
    expect(user.text).toBe('images')
    expect(user.images).toHaveLength(4)
    expect(user.drawing).toBeUndefined()
    expect(user.notes).toEqual([
      { note: 'M1', revision: 1, over: { faces: ['a/F1'], cuts: [], scans: [], bare: [], partly: [1], strokes: 1 } },
      { note: 'M3', revision: 1, over: { faces: ['a/F1'], cuts: [], scans: [], bare: [], partly: [1], strokes: 1 } }
    ])
  }, 30_000)

  it('has the notes it carried among the marks sent once the answer has left, whether or not the hook listed them', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 0), await noteOf(c, 'M2', 0)]
    marks = ['M2', 'M4']
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    expect([...delivered2[0]].sort()).toEqual(['M1', 'M2', 'M4'])
    // The next prompt carries what it is given then, and the notes are not told twice.
    drafted = []
    marks = ['M5']
    await c.send('say again')
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(2)
    expect(delivered2[1]).toEqual(['M5'])
  }, 30_000)

  it('has a note it carried sent even when the hook has nothing to say: it is in the prompt itself', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 0)]
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    expect(delivered2).toEqual([['M1']])
  }, 30_000)

  it('carries a draft note once when two prompts are queued behind a turn, and has it sent with the prompt that carried it, not with the one before', async () => {
    const c = await start()
    marksPerCall = [['M1'], ['M9'], ['M10']]
    await c.send('slow 1.5')
    drafted = [await noteOf(c, 'M5', 0)]
    await c.send('say a')
    // The note is still a draft as far as the project knows (the first prompt's hook has not come): the next prompt leaves it to the one that has it.
    await c.send('say b')
    const users = c.items().filter((i) => i.kind === 'user') as Array<{ state: string; notes?: unknown[]; images: unknown[] }>
    expect(users.map((u) => u.notes?.length ?? 0)).toEqual([0, 1, 0])
    expect(users.map((u) => u.images.length)).toEqual([0, 1, 0])
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(3)
    // M5 went with the hook of the prompt that carried it (the second), and with no other.
    expect(delivered2).toEqual([['M1'], ['M9', 'M5'], ['M10']])
  }, 30_000)

  it('leaves a note a draft when the prompt that carried it was queued and the session ended before its hook', async () => {
    const c = await start()
    marksPerCall = [['M1']]
    await c.send('slow 5')
    await expect.poll(() => delivered2.length, { timeout: 20_000 }).toBe(1)
    drafted = [await noteOf(c, 'M5', 0)]
    await c.send('say a')
    await tSessions.stop(c.id)
    const [, queued] = c.items().filter((i) => i.kind === 'user') as Array<{ state: string }>
    // The CLI may run what is queued as it goes (the interrupt leaves it to run): only a prompt that was not taken up leaves the note unsent.
    if (queued.state === 'not-sent') expect(delivered2.flat()).not.toContain('M5')
    expect(delivered2[0]).toEqual(['M1'])
  }, 30_000)

  it('attaches no draft note to a slash command: the note goes with the prompt after it, and is sent with that', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M5', 0)]
    await c.send('/compact')
    await c.send('say fix it')
    await expect.poll(() => c.items().filter((i) => i.kind === 'turn').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
    const users = c.items().filter((i) => i.kind === 'user') as Array<{ notes?: unknown[] }>
    expect(users.map((u) => u.notes?.length ?? 0)).toEqual([0, 1])
    await expect.poll(() => delivered2.flat(), { timeout: 20_000 }).toContain('M5')
  }, 30_000)

  it('carries at most 6 pictures in all, the attached view first, and names the rest in the words of the note they belong to', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 3), await noteOf(c, 'M2', 3), await noteOf(c, 'M3', 3)]
    await c.send('images', { attachedView: new Uint8Array(PNG_4X4) })
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    // The view, M1's four, M2's picture: six.
    expect(said(c)).toContain('images: 6 4x4 800x600 300x200 301x200 302x200 800x600')
    const words = said(c).join('\n')
    expect(words).toContain('Not attached: M2 reference 1, M2 reference 2, M2 reference 3')
    expect(words).toContain('Not attached: M3, M3 reference 1, M3 reference 2, M3 reference 3')
    expect((c.items()[0] as { images: unknown[] }).images).toHaveLength(6)
    expect((c.items()[0] as { notes?: unknown[] }).notes).toHaveLength(3)
  }, 30_000)

  it('carries 3 notes of 3 references each as 6 pictures when no view is attached', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 3), await noteOf(c, 'M2', 3), await noteOf(c, 'M3', 3)]
    await c.send('images')
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    expect(said(c)).toContain('images: 6 800x600 300x200 301x200 302x200 800x600 300x200')
    expect(said(c).join('\n')).toContain('Not attached: M2 reference 2, M2 reference 3')
  }, 30_000)

  it('carries a note whose pictures are not on this computer as words only, and the notes after it as usual', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 1, { w: 800, h: 600 }, false), await noteOf(c, 'M2', 0, { w: 640, h: 480 })]
    await c.send('images')
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    expect(said(c)).toContain('images: 1 640x480')
    expect(said(c)).toContain('The picture is not on this computer; look through its camera.')
    expect((c.items()[0] as { images: unknown[]; notes?: unknown[] }).images).toHaveLength(1)
    expect((c.items()[0] as { notes?: unknown[] }).notes).toHaveLength(2)
  }, 30_000)

  it('sends a prompt of notes alone, with no words of the person', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 0)]
    await c.send('')
    expect(c.items()[0]).toMatchObject({ kind: 'user', text: '', images: [expect.objectContaining({ width: 800, height: 600 })] })
  }, 30_000)

  it('logs what the ink of each note lies over as text, with no picture, no words of the note, no coordinate and no kernel line', async () => {
    const c = await start()
    drafted = [await noteOf(c, 'M1', 1)]
    await c.send('images')
    await expect.poll(() => c.turns(), { timeout: 20_000 }).toBe(1)
    await tSessions.stop(c.id)
    const [file] = c.logFile()
    const user = JSON.stringify(lines(file)[0])
    // The stand-in echoes the words it was sent, so only the prompt's own line is looked at for them.
    expect(readFileSync(file, 'utf8')).not.toContain('iVBOR')
    expect(user).not.toContain('view note')
    expect(user).not.toContain('plane, normal')
    expect(user).not.toContain('position')
    expect(lines(file)[0]).toMatchObject({ kind: 'user', notes: [{ note: 'M1', revision: 1, over: { faces: ['a/F1'] } }] })
  }, 30_000)

  it('carries no note into a prompt when the project has none', async () => {
    const c = await start()
    await c.send('say plain')
    expect((c.items()[0] as { notes?: unknown }).notes).toBeUndefined()
  }, 30_000)

  it('keeps the data of the newest pictures only, and never writes it', async () => {
    const c = await start()
    picture = async () => PNG_4X4
    await c.send('say one', { attachView: true })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    await tSessions.stop(c.id)
    const [file] = c.logFile()
    expect(readFileSync(file, 'utf8')).not.toContain('iVBOR')
    expect((lines(file)[0] as { images: unknown[] }).images).toEqual([expect.objectContaining({ mediaType: 'image/png', width: 4, height: 4 })])
  })

  it('shows a request of the agent\'s as open until it is answered, and as allowed with the answer it was given', async () => {
    const c = await start()
    await c.send('ask Bash {"command":"ls"}')
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    const open = c.items().find((i) => i.kind === 'ask')!
    expect(open).toMatchObject({ toolName: 'Bash', input: { command: 'ls' }, suggestions: true, state: 'open' })
    // The window may not change what a tool is run with: the request's own input goes back.
    tSessions.respond(c.id, (open as { requestId: string }).requestId, { allow: true, updatedInput: { command: 'rm -rf /' } })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'ask')).toMatchObject({ state: 'allowed' })
    expect(c.items().find((i) => i.kind === 'tool')).toMatchObject({ result: 'allowed: {"command":"ls"}' })
  })

  describe("which saves of a turn are Claude's (#384)", () => {
    type Chat = Awaited<ReturnType<typeof start>>
    const at = (c: Chat, name = 'part.py'): string => join(c.obj.dir, name)
    const wrote = (c: Chat, name?: string) => tSessions.wroteBy(c.obj.id, at(c, name))
    const tools = (c: Chat) => c.items().filter((i) => i.kind === 'tool')
    /** The prompt `n` of the chat as a save names it. */
    const promptOf = (c: Chat, n = 0) => {
      const user = c.items().filter((i) => i.kind === 'user')[n] as Extract<ChatItem, { kind: 'user' }>
      return { turn: { conversation: expect.stringMatching(UUID), prompt: user.id, text: user.text.slice(0, 200) } }
    }
    const over = (c: Chat, n: number) => expect.poll(() => c.turns(), { timeout: 5000 }).toBe(n)
    const asked = async (c: Chat) => {
      await expect.poll(() => c.items().some((i) => i.kind === 'ask' && i.state === 'open')).toBe(true)
      return c.items().find((i) => i.kind === 'ask' && i.state === 'open') as Extract<ChatItem, { kind: 'ask' }>
    }

    it('is not one the person makes while the turn works, with a command that only reads under way', async () => {
      const c = await start()
      await c.send('work 2')
      await expect.poll(() => tools(c).length).toBe(1)
      writeFileSync(at(c), 'mine')
      expect(tSessions.turnNow(c.obj.id)).toBeDefined()
      expect(wrote(c)).toBeUndefined()
      await over(c, 1)
      expect(wrote(c)).toBeUndefined()
    })

    it('is one its Write or Edit made, with the prompt, until the person saves over it', async () => {
      const c = await start()
      await c.send('write part.py claude\nwrite extra.py x\nedit extra.py x y')
      await over(c, 1)
      expect(wrote(c)).toEqual(promptOf(c))
      expect(wrote(c, 'extra.py')).toEqual(promptOf(c))
      await new Promise((r) => setTimeout(r, 30))
      writeFileSync(at(c), 'mine, after')
      expect(wrote(c)).toBeUndefined()
    })

    it('is one a command of its that may write made, and not one made while that command waited to be allowed', async () => {
      const c = await start()
      await c.send('ask Bash {"command":"python gen.py"}')
      const ask = await asked(c)
      writeFileSync(at(c), 'mine, while the card waits')
      expect(wrote(c)).toBeUndefined()
      // Further from the answer than the slack an mtime is given.
      await new Promise((r) => setTimeout(r, 50))
      tSessions.respond(c.id, ask.requestId, { allow: true })
      await over(c, 1)
      expect(wrote(c)).toBeUndefined()
      await c.send('bash printf generated > gen.py')
      await over(c, 2)
      expect(wrote(c, 'gen.py')).toEqual(promptOf(c, 1))
    })

    it('is not one made after a command of its that failed ended, which only its result says', async () => {
      const c = await start()
      await c.send('bash exit 1\nwork 2')
      await expect.poll(() => tools(c).length).toBe(2)
      await new Promise((r) => setTimeout(r, 50))
      writeFileSync(at(c), 'mine')
      expect(wrote(c)).toBeUndefined()
    })

    it('is not one made after a request the person refused', async () => {
      const c = await start()
      await c.send(`ask Edit ${JSON.stringify({ file_path: 'part.py', old_string: 'a', new_string: 'b' })}\nwork 2`)
      tSessions.respond(c.id, (await asked(c)).requestId, { allow: false, message: '' })
      await expect.poll(() => tools(c).length).toBe(2)
      writeFileSync(at(c), 'mine')
      expect(wrote(c)).toBeUndefined()
    })

    it('is one made by a call whose request the CLI gave up and then ran all the same (decided elsewhere)', async () => {
      const c = await start()
      await c.send('elsewhere printf generated > gen.py')
      await over(c, 1)
      expect(wrote(c, 'gen.py')).toEqual(promptOf(c))
    })

    it('is not one made while a request waited that the turn was stopped over', async () => {
      const c = await start()
      await c.send(`ask Edit ${JSON.stringify({ file_path: 'part.py', old_string: 'a', new_string: 'b' })}`)
      await asked(c)
      writeFileSync(at(c), 'mine')
      await tSessions.control(c.id, { subtype: 'interrupt' })
      await over(c, 1)
      expect(wrote(c)).toBeUndefined()
    })

    it('is not one made after a Write of its that torno refused', async () => {
      const c = await start()
      await c.send('write brief.md claude')
      await over(c, 1)
      writeFileSync(at(c, 'brief.md'), 'mine')
      expect(wrote(c, 'brief.md')).toBeUndefined()
    })

    it("names the prompt of a command's turn by the command", async () => {
      const c = await start()
      await c.send('say hello')
      await over(c, 1)
      await c.send('/skill\nwrite part.py claude')
      await over(c, 2)
      expect(wrote(c)).toEqual(promptOf(c, 1))
    })
  })

  it('takes the answers of a question from the window and nothing else of its input', async () => {
    const c = await start()
    const input = { questions: [{ question: 'Which wall?', header: 'Wall', multiSelect: false, options: [{ label: '2 mm', description: 'thin' }] }] }
    await c.send(`ask AskUserQuestion ${JSON.stringify(input)}`)
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    const ask = c.items().find((i) => i.kind === 'ask') as { requestId: string }
    tSessions.respond(c.id, ask.requestId, { allow: true, updatedInput: { answers: { 'Which wall?': '3 mm' }, questions: [], sneaky: true } })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'tool')).toMatchObject({ result: `allowed: ${JSON.stringify({ ...input, answers: { 'Which wall?': '3 mm' } })}` })
    expect(c.items().find((i) => i.kind === 'ask')).toMatchObject({ state: 'allowed', answer: 'Which wall?: 3 mm' })
  })

  it('denies with the reason, and answers a request that is not open with nothing', async () => {
    const c = await start()
    await c.send('ask Write {"file_path":"x"}')
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    const ask = c.items().find((i) => i.kind === 'ask') as { requestId: string }
    tSessions.respond(c.id, ask.requestId, { allow: false, message: 'not there' })
    tSessions.respond(c.id, ask.requestId, { allow: false, message: 'again' })
    tSessions.respond(c.id, 'req_unknown', { allow: true })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'ask')).toMatchObject({ state: 'denied', answer: 'not there' })
    expect(c.items().find((i) => i.kind === 'tool')).toMatchObject({ result: 'denied: not there' })
  })

  it('denies with a sentence of its own when no reason was typed, and passes the suggestions back only for "always"', async () => {
    const c = await start()
    await c.send('ask Write {"file_path":"x"}\nask Bash {"command":"ls"}')
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    const first = c.items().find((i) => i.kind === 'ask') as { requestId: string }
    tSessions.respond(c.id, first.requestId, { allow: false, message: '' })
    await expect.poll(() => c.items().filter((i) => i.kind === 'ask').length).toBe(2)
    const second = c.items().filter((i) => i.kind === 'ask')[1] as { requestId: string }
    tSessions.respond(c.id, second.requestId, { allow: true, always: true })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    const tools = c.items().filter((i) => i.kind === 'tool') as Array<{ result?: string }>
    expect(tools[0].result).toBe('denied: The person denied this.')
    // Of the three kinds the CLI suggests, only the rule goes back, and as a rule of the session.
    expect(tools[1].result).toContain('permissions: [{"type":"addRules","rules":[{"toolName":"Bash"}],"behavior":"allow","destination":"session"}]')
  })

  it('keeps of the answers to a question only those of the questions that were asked', async () => {
    const c = await start()
    const input = { questions: [{ question: 'Which wall?', header: 'Wall', multiSelect: false, options: [{ label: '2 mm', description: 'thin' }] }] }
    await c.send(`ask AskUserQuestion ${JSON.stringify(input)}`)
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    const ask = c.items().find((i) => i.kind === 'ask') as { requestId: string }
    tSessions.respond(c.id, ask.requestId, { allow: true, updatedInput: { answers: { 'Which wall?': '3 mm', 'Anything else?': 'rm' } } })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'tool')).toMatchObject({ result: `allowed: ${JSON.stringify({ ...input, answers: { 'Which wall?': '3 mm' } })}` })
  })

  it('shows what the request says in words and the path it is blocked on, and offers "for this session" only when there is a rule', async () => {
    const c = await start()
    await c.send('ask Bash {"command":"touch made.txt","description":"Create made.txt","blocked_path":"/work/obj/made.txt"}')
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    expect(c.items().find((i) => i.kind === 'ask')).toMatchObject({ description: 'Create made.txt', blockedPath: '/work/obj/made.txt', suggestions: true })
  })

  it('takes a /compact for a turn of no turns: the boundary is told, the prompt is sent, and the session is idle after it', async () => {
    const c = await start()
    await c.send('/compact')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().map((i) => i.kind)).toEqual(['user', 'note', 'turn'])
    expect(c.items()[0]).toMatchObject({ state: 'sent', text: '/compact' })
    expect(c.items()[1]).toMatchObject({ text: 'Conversation compacted: 29,569 → 3,637 tokens', tone: 'quiet' })
    expect(c.items()[2]).toMatchObject({ ok: true, stopped: false })
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('idle')
    // Nothing waits behind it: the next prompt is not queued.
    await c.send('say after')
    expect(c.items().find((i) => i.kind === 'user' && i.text === 'say after')).toMatchObject({ state: 'sent' })
  })

  it('says once that the hooks do not reach torno when the agent posts none, and moves no status', async () => {
    process.env.FAKE_AGENT_NO_HOOKS = '1'
    try {
      const c = await start()
      await c.send('say one')
      await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
      await c.send('say two')
      await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
      const notes = c.items().filter((i) => i.kind === 'note' && i.text.startsWith("Claude Code's hooks did not reach torno"))
      expect(notes).toHaveLength(1)
      expect(notes[0]).toMatchObject({ tone: 'warn' })
    } finally {
      delete process.env.FAKE_AGENT_NO_HOOKS
    }
  })

  it('says that Claude Code runs bare when no hook arrives and the init names an API key source', async () => {
    process.env.FAKE_AGENT_NO_HOOKS = '1'
    process.env.FAKE_AGENT_INIT = JSON.stringify({ apiKeySource: 'ANTHROPIC_API_KEY' })
    try {
      const c = await start()
      await c.send('say one')
      await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
      await c.send('say two')
      await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
      const notes = c.items().filter((i) => i.kind === 'note' && i.text.startsWith('Claude Code is running bare'))
      expect(notes).toHaveLength(1)
      expect(notes[0]).toMatchObject({ tone: 'warn' })
      expect(c.items().some((i) => i.kind === 'note' && i.text.startsWith("Claude Code's hooks did not reach"))).toBe(false)
    } finally {
      delete process.env.FAKE_AGENT_NO_HOOKS
      delete process.env.FAKE_AGENT_INIT
    }
  })

  it('keeps the ordinary session unchanged: an API key with hooks arriving says nothing of bare', async () => {
    process.env.FAKE_AGENT_INIT = JSON.stringify({ apiKeySource: 'ANTHROPIC_API_KEY' })
    try {
      const c = await start()
      await c.send('say one')
      await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
      expect(c.items().some((i) => i.kind === 'note' && (i.text.includes('running bare') || i.text.includes('hooks did not reach')))).toBe(false)
    } finally {
      delete process.env.FAKE_AGENT_INIT
    }
  })

  it('says nothing of hooks when they arrive', async () => {
    const c = await start()
    await c.send('say one')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().some((i) => i.kind === 'note' && i.text.includes('hooks did not reach'))).toBe(false)
  })

  it('closes what is open when the session ends: the request is not answered, the queued prompt not sent', async () => {
    const c = await start()
    await c.send('ask Bash {"command":"ls"}')
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    await c.send('say never')
    await tSessions.stop(c.id)
    const items = c.items()
    expect(items.find((i) => i.kind === 'ask')).toMatchObject({ state: 'ended' })
    // The interrupt that stopping sends leaves the queued prompt to run, as the CLI does: sent if it began before the
    // process went, not sent if not (the transcript's own tests hold the second).
    expect(['sent', 'not-sent']).toContain((items.filter((i) => i.kind === 'user')[1] as { state: string }).state)
    expect(items.find((i) => i.kind === 'tool')).toMatchObject({ state: 'cancelled' })
    expect(items.at(-1)).toMatchObject({ kind: 'note', text: 'The session ended' })
  })

  it('stops the tool and the text an interrupt cut short; the prompt queued behind it is then run', async () => {
    const c = await start()
    await c.send('slow 5')
    await c.send('say kept')
    await expect.poll(() => c.items().some((i) => i.kind === 'text' && i.streaming)).toBe(true)
    await tSessions.control(c.id, { subtype: 'interrupt' })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    expect(c.items().find((i) => i.kind === 'turn')).toMatchObject({ ok: false, stopped: true })
    expect(c.items().filter((i) => i.kind === 'user').map((i) => (i as { state: string }).state)).toEqual(['sent', 'sent'])
    expect(c.items().filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)).toContain('kept')
    expect(c.items().some((i) => i.kind === 'text' && i.streaming)).toBe(false)
  })

  it('tells the model and the connection of torno\'s tools as meta', async () => {
    const c = await start()
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(metas.filter((m) => m.sessionId === c.id).at(-1)?.meta).toMatchObject({ model: 'fake-model', tornoConnected: true })
    await tSessions.control(c.id, { subtype: 'set_model', model: 'haiku' })
    await c.send('say again')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    expect(tSessions.history(c.id)!.meta.model).toBe('haiku')
    expect(c.items().some((i) => i.kind === 'note' && i.text === 'Model: haiku')).toBe(true)
  })

  it('tells the window the commands and models when the agent has said them, after the history may have been had without', async () => {
    const c = await start()
    await expect.poll(() => abilities.length).toBe(1)
    const [told1] = abilities
    expect(told1).toMatchObject({ sessionId: c.id, objectId: c.obj.id })
    expect(told1.commands.map((x) => x.name)).toEqual(['compact', 'clear'])
    expect(told1.models).toEqual([{ value: 'default', displayName: 'Default', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, { value: 'haiku', displayName: 'Haiku', efforts: ['low', 'medium', 'high'] }])
    // It counts among the things told, so that a history asked for before it can be told from one after it.
    expect(told1.seq).toBe(tSessions.history(c.id)!.seq)
  })

  it('has the commands and models of the agent in its history, and the rate limit in its meta', async () => {
    const c = await start()
    await expect.poll(() => tSessions.history(c.id)!.commands.length).toBe(2)
    expect(tSessions.history(c.id)!.models).toEqual([{ value: 'default', displayName: 'Default', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] }, { value: 'haiku', displayName: 'Haiku', efforts: ['low', 'medium', 'high'] }])
    await c.send('rate 72')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(tSessions.history(c.id)!.meta.rate).toMatchObject({ window: 'five_hour', used: 72 })
  })

  it('goes on past a line that is not JSON and a message from the future', async () => {
    const c = await start()
    await c.send('garbage\nsay still here')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'text')).toMatchObject({ text: 'still here' })
  })


  // --- the final fix wave ------------------------------------------------------------------------------------

  it('closes the card of a request the CLI cancels when the person presses Stop: no buttons, an idle session, and the next ask works', async () => {
    const c = await start()
    await c.send('ask Bash {"command":"ls"}')
    await expect.poll(() => c.items().some((i) => i.kind === 'ask')).toBe(true)
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('needs_input')
    const first = c.items().find((i) => i.kind === 'ask') as { requestId: string }
    await tSessions.control(c.id, { subtype: 'interrupt' })
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.items().find((i) => i.kind === 'ask')).toMatchObject({ state: 'ended', why: 'the turn was stopped' })
    // Main let go of the request: nothing stale is left to hold the status of the next one.
    expect(givenUp).toEqual([first.requestId])
    expect(c.items().find((i) => i.kind === 'turn')).toMatchObject({ ok: false, stopped: true })
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('idle')
    // An answer to it does nothing (and does not say "Allowed").
    tSessions.respond(c.id, first.requestId, { allow: true })
    expect(c.items().find((i) => i.kind === 'ask')).toMatchObject({ state: 'ended' })
    // The stale request does not hold a later one: answered, the session works again and ends idle.
    await c.send('ask Bash {"command":"pwd"}')
    await expect.poll(() => c.items().filter((i) => i.kind === 'ask').length).toBe(2)
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('needs_input')
    const second = c.items().filter((i) => i.kind === 'ask')[1] as { requestId: string }
    tSessions.respond(c.id, second.requestId, { allow: true })
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('working')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('idle')
  })

  it('takes a prompt sent while a tool runs as part of the turn: one result, its context under it, nothing queued after', async () => {
    marksPerCall = [[], ['M7']]
    const c = await start()
    await c.send('work 1\nsay first answer')
    await expect.poll(() => c.items().some((i) => i.kind === 'tool' && i.state === 'running')).toBe(true)
    await c.send('say folded answer')
    expect(c.items().filter((i) => i.kind === 'user').map((i) => (i as { state: string }).state)).toEqual(['sent', 'queued'])
    await expect.poll(() => c.turns(), { timeout: 8000 }).toBe(1)
    const users = c.items().filter((i) => i.kind === 'user') as Array<{ id: string; text: string; state: string }>
    expect(users.map((u) => u.state)).toEqual(['sent', 'sent'])
    expect(c.items().map((i) => (i.kind === 'user' ? i.text : i.kind))).toEqual(['work 1\nsay first answer', 'tool', 'say folded answer', 'context', 'text', 'text', 'turn'].filter((k) => k !== 'context' || marksPerCall[1].length > 0))
    expect(c.items().find((i) => i.kind === 'context')).toMatchObject({ forUser: users[1].id, marks: ['M7'] })
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('idle')
    // The next prompt is not off by one: sent at once, and answered.
    await c.send('say third')
    expect(c.items().filter((i) => i.kind === 'user').map((i) => (i as { state: string }).state)).toEqual(['sent', 'sent', 'sent'])
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('idle')
  })

  it('tells the person what Claude Code said when it stops without a line of output, and that it did not start', async () => {
    process.env.FAKE_AGENT_FAIL = 'error: unknown option --permission-prompt-tool'
    try {
      const c = await start()
      await expect.poll(() => tSessions.current(c.obj.id), { timeout: 8000 }).toBeNull()
      const notes = c.items().filter((i) => i.kind === 'note') as Array<{ text: string; tone: string }>
      expect(notes.map((n) => n.text)).toEqual([
        'Claude Code stopped (exit code 1): error: unknown option --permission-prompt-tool',
        'It did not start: is `claude` up to date and signed in? Try the terminal view to see why.',
        'The session ended'
      ])
      expect(notes.map((n) => n.tone)).toEqual(['warn', 'warn', 'quiet'])
    } finally {
      delete process.env.FAKE_AGENT_FAIL
    }
  })

  it('says a stop it did not ask for, though the exit code was 0, and does not say one it asked for', async () => {
    const asked = await start()
    await tSessions.stop(asked.id)
    expect(asked.items().filter((i) => i.kind === 'note').map((n) => (n as { text: string }).text)).toEqual(['The session ended'])
    const c = await start()
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    process.kill(tSessions.current(c.obj.id)!.pid, 'SIGKILL')
    await expect.poll(() => tSessions.current(c.obj.id), { timeout: 8000 }).toBeNull()
    const notes = c.items().filter((i) => i.kind === 'note') as Array<{ text: string; tone: string }>
    expect(notes[0]).toMatchObject({ text: 'Claude Code stopped (signal SIGKILL)', tone: 'warn' })
    // It had spoken: it is not said not to have started.
    expect(notes.map((n) => n.text).join('\n')).not.toContain('did not start')
  })

  it('notes, quietly, that Claude Code did not answer initialize', async () => {
    process.env.FAKE_AGENT_INIT_ERROR = 'unknown request initialize'
    try {
      const c = await start()
      await expect.poll(() => c.items().some((i) => i.kind === 'note'), { timeout: 5000 }).toBe(true)
      expect(c.items().find((i) => i.kind === 'note')).toMatchObject({ tone: 'quiet', text: expect.stringContaining('Claude Code did not say what it can do (unknown request initialize)') })
    } finally {
      delete process.env.FAKE_AGENT_INIT_ERROR
    }
  })

  it('sends a prompt with a picture before the prompt sent after it', async () => {
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
    picture = () => new Promise((resolve) => setTimeout(() => resolve(png), 400))
    const c = await start()
    const first = c.send('say with a picture', { attachView: true })
    const second = c.send('say plain')
    await Promise.all([first, second])
    expect(c.items().filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text)).toEqual(['say with a picture', 'say plain'])
    await expect.poll(() => c.turns(), { timeout: 8000 }).toBe(2)
  })

  it('still takes a prompt up that had no hook and no init, when other lines came inside the moment it was waited for', async () => {
    const c = await start()
    await c.send('slow 0.3')
    await c.send('/silent')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    // The silent command's own line came just after the result: the wait begins again, and ends.
    await expect.poll(() => c.items().filter((i) => i.kind === 'user').map((i) => (i as { state: string }).state), { timeout: 6000 }).toEqual(['sent', 'sent'])
    await expect.poll(() => tSessions.current(c.obj.id)?.status).toBe('idle')
  })

  it('names the chat of an object that has ended, for a window loaded since, and none while one runs', async () => {
    const c = await start()
    expect(tSessions.endedChat(c.obj.id)).toBeUndefined()
    await tSessions.stop(c.id)
    expect(tSessions.endedChat(c.obj.id)).toBe(c.id)
    const again = await start({ folder: c.obj.id })
    expect(again.obj.id).toBe(c.obj.id)
    expect(tSessions.endedChat(c.obj.id)).toBeUndefined()
  })

  it('lets go of the transcripts of sessions that have ended when asked, and keeps one that runs', async () => {
    const gone = await start()
    await tSessions.stop(gone.id)
    const live = await start()
    expect(tSessions.history(gone.id)).toBeDefined()
    tSessions.forgetEnded()
    expect(tSessions.history(gone.id)).toBeUndefined()
    expect(tSessions.history(live.id)).toBeDefined()
  })

})

// #116: what Claude Code says of itself in its `init` and per turn, played by the stand-in (FAKE_AGENT_INIT).
describe('what Claude Code says of itself', () => {
  let ownHttp: HttpRouter
  let own: Sessions
  let count = 0
  const metas: Array<{ sessionId: string; meta: ChatMeta }> = []
  const prompts: string[] = []

  beforeAll(async () => {
    ownHttp = recording(await startHttp())
    // Given a folder for torno's plugin, as the app is: its skills are expected in the `init`.
    own = new Sessions({
      configDir,
      http: ownHttp,
      adapter: claudeAdapter(`node ${FAKE}`, '/fake/agent-plugin'),
      viewFor: () => 'chat',
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      systemPromptFor: (adapter) => {
        const text = adapter.skills ? 'WITH SKILLS' : 'FULL PROMPT'
        prompts.push(text)
        return text
      },
      mcpUrlFor: (id) => ownHttp.url(`/mcp/${id}`)
    })
    own.on('meta', (m) => metas.push({ sessionId: m.sessionId, meta: m.meta }))
  })
  afterEach(async () => {
    await own.stopAll()
    delete process.env.FAKE_AGENT_INIT
    metas.length = 0
    prompts.length = 0
  })
  afterAll(async () => {
    await ownHttp.close()
  })

  async function chat(init: object | undefined, opts: { folder?: string; resume?: boolean; skills?: false } = {}) {
    if (init) process.env.FAKE_AGENT_INIT = JSON.stringify(init)
    else delete process.env.FAKE_AGENT_INIT
    count += 1
    const obj = object(opts.folder ?? `account-${count}`)
    const { sessionId: id } = await own.start(obj, { resume: opts.resume, skills: opts.skills })
    const items = (): ChatItem[] => own.history(id)!.items
    return {
      obj,
      id,
      items,
      notes: () => items().filter((i): i is Extract<ChatItem, { kind: 'note' }> => i.kind === 'note'),
      turns: () => items().filter((i) => i.kind === 'turn').length,
      meta: () => own.history(id)!.meta,
      send: (text: string) => own.send(id, { text })
    }
  }

  it("warns when torno's plugin is not in the CLI's init, and a restart on the whole prompt leaves the plugin out and warns no more", async () => {
    const c = await chat({ plugins: [] })
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.meta().pluginLoaded).toBe(false)
    expect(c.notes()).toMatchObject([{ tone: 'warn', text: "torno's skills did not load: the agent is told to read skills it does not have" }])
    await c.send('argv')
    await expect.poll(() => c.turns(), { timeout: 15000 }).toBe(2)
    const first = JSON.parse((c.items().filter((i) => i.kind === 'text').at(-1) as { text: string }).text) as string[]
    expect(first).toContain('--plugin-dir')
    expect(first[first.indexOf('--append-system-prompt') + 1]).toBe('WITH SKILLS')

    // The person says to start on the whole prompt: the same conversation, without the plugin.
    await own.stop(c.id)
    const again = await chat({ plugins: [] }, { folder: c.obj.id, resume: true, skills: false })
    expect(again.id).not.toBe(c.id)
    await again.send('argv')
    await expect.poll(() => again.turns(), { timeout: 15000 }).toBe(1)
    const second = JSON.parse((again.items().filter((i) => i.kind === 'text').at(-1) as { text: string }).text) as string[]
    expect(second).not.toContain('--plugin-dir')
    expect(second[second.indexOf('--append-system-prompt') + 1]).toBe('FULL PROMPT')
    expect(second[second.indexOf('--resume') + 1]).toBe(first[first.indexOf('--session-id') + 1])
    expect(again.meta().pluginLoaded).toBeUndefined()
    expect(again.notes()).toEqual([])
  })

  it('says nothing of a session whose init is as the recordings have it: its plugin listed, none of its skills in `skills`', async () => {
    const c = await chat(undefined)
    await c.send('say hi')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.meta()).toMatchObject({ pluginLoaded: true, apiKeySource: 'none', version: '2.1.300' })
    expect(c.notes()).toEqual([])
  })

  it('says the API key and the version outside the tested range, once each, and keeps the cost', async () => {
    const c = await chat({ apiKeySource: 'user', claude_code_version: '2.2.0' })
    await c.send('say one')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    await c.send('say two')
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(2)
    expect(c.meta()).toMatchObject({ pluginLoaded: true, apiKeySource: 'user', version: '2.2.0' })
    expect(c.notes().map((n) => n.text)).toEqual([
      "This chat is billed to an API key (Claude Code names its source: `user`), not to your Claude login: you pay per token. An `ANTHROPIC_API_KEY` in torno's environment, for example, does this.",
      'Claude Code 2.2.0 is newer than the versions torno was checked with (2.1.300 to 2.1.301): if something in the chat looks wrong, this may be why.'
    ])
    expect(c.notes().map((n) => n.tone)).toEqual(['quiet', 'quiet'])
  })

  it("says torno's tools are not connected with what the CLI said, and a retry and a denial no card shows", async () => {
    const c = await chat({ mcp_servers: [{ name: 'torno', status: 'failed' }], mcp_server_errors: [{ name: 'torno', error: 'connection refused' }] })
    await c.send('retry 3\nslow 0.3\ndeny Write {"file_path":"/etc/x","content":"y"}')
    await expect.poll(() => metas.some((m) => m.sessionId === c.id && m.meta.retrying?.attempt === 3), { timeout: 5000 }).toBe(true)
    await expect.poll(() => c.turns(), { timeout: 5000 }).toBe(1)
    expect(c.meta().retrying).toBeUndefined()
    expect(c.notes().map((n) => n.text)).toEqual(["torno's tools are not connected to Claude Code: it cannot see the part. Claude Code said: connection refused", 'Permission denied: Write /etc/x'])
  })
})

describe('the question before a chat in a folder with settings of its own', () => {
  let tHttp: HttpRouter
  let trustSessions: Sessions
  const trust = () => new Trust(null, root)

  beforeAll(async () => {
    tHttp = recording(await startHttp())
    trustSessions = new Sessions({
      configDir,
      http: tHttp,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: async () => ({ text: '', sentMarkIds: [] }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => tHttp.url(`/mcp/${id}`),
      trust: trust()
    })
  })
  afterEach(async () => {
    await trustSessions.stopAll()
  })
  afterAll(async () => {
    await tHttp.close()
  })

  it('refuses the chat with the question, starts nothing, and starts it once the person has said yes', async () => {
    const obj = object('trust-1')
    writeFileSync(join(obj.dir, '.mcp.json'), '{}')
    const refused = await trustSessions.start(obj, {}).catch((e: Error) => e)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toBe('This folder has Claude Code settings of its own (.mcp.json) that the chat would load without asking. Start the chat anyway?')
    expect(trustSessions.current(obj.id)).toBeNull()
    expect(trustSessions.size).toBe(0)
    // Nothing was written in the folder for it.
    expect(existsSync(join(obj.dir, '.torno'))).toBe(false)
    await trustSessions.trust(obj)
    const started = await trustSessions.start(obj, {})
    expect(started.view).toBe('chat')
    expect(trustSessions.current(obj.id)).not.toBeNull()
  })

  it('asks nothing of a folder without settings', async () => {
    const started = await trustSessions.start(object('trust-2'), {})
    expect(started.view).toBe('chat')
  })

  it('asks nothing for the terminal, which has Claude Code\'s own question', async () => {
    const terminal = new Sessions({
      configDir,
      http: tHttp,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'terminal',
      contextFor: async () => ({ text: '', sentMarkIds: [] }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => tHttp.url(`/mcp/${id}`),
      trust: trust()
    })
    const obj = object('trust-3')
    writeFileSync(join(obj.dir, '.mcp.json'), '{}')
    const started = await terminal.start(obj, {})
    expect(started.view).toBe('terminal')
    await terminal.stopAll()
  })
})

describe('the build, told by the hooks of a turn (Claude Code)', () => {
  /** What the stand-in builds say of each object, and the manager they are told to. */
  let states: Map<string, BuildState>
  let made: Sessions
  let n = 0
  /** Each manager its own server: the first to route `/hooks` on one is the one that answers there. */
  let own: HttpRouter | null = null
  afterEach(async () => {
    await own?.close()
    own = null
  })
  const told = (id: string): PromptContext => {
    const s = states.get(id)
    const text = !s ? '' : s.status === 'failed' ? `BUILD FAILED\n${s.error?.message}` : `r${s.revision} ok`
    return { text, sentMarkIds: [], ...(s ? { revision: s.revision, buildState: s.status === 'ok' ? ('ok' as const) : ('failed' as const) } : {}) }
  }
  function land(state: BuildState): void {
    states.set(state.objectId, state)
    made.built(state)
  }
  async function begun(
    opts: {
      wait?: number
      grace?: number
      /** How long a Stop waits for a build that runs. */
      stop?: number
      context?: (id: string) => PromptContext | Promise<PromptContext>
      scene?: (id: string) => { revision: number; scene: Scene } | undefined
      verdicts?: (id: string, revision: number | undefined) => BuildVerdicts | undefined
      settled?: (id: string, revision: number, until: number) => Promise<void>
      detail?: (id: string, markId: string, revision: number) => Promise<string | undefined>
      /** When the object's newest source was saved (`sourcesSaved`). */
      saved?: (dir: string) => Promise<number | null>
      /** The files the last build imported from beside the project (`uses`). */
      uses?: string[]
      /** The session is a chat (the stand-in as a stream): there is no terminal to wait for. */
      chat?: boolean
    } = {}
  ) {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => (opts.chat ? 'chat' : 'terminal'),
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      build: (id) => states.get(id),
      buildContextFor: (id) => (opts.context ?? told)(id),
      ...(opts.scene ? { scene: opts.scene } : {}),
      ...(opts.verdicts ? { verdicts: opts.verdicts } : {}),
      ...(opts.settled ? { settled: opts.settled } : {}),
      ...(opts.detail ? { dimensionDetail: opts.detail } : {}),
      ...(opts.saved ? { sourcesSaved: opts.saved } : {}),
      ...(opts.uses ? { uses: () => opts.uses! } : {}),
      editTiming: { answerMs: opts.wait ?? 5000, graceMs: opts.grace ?? 1500, ...(opts.stop === undefined ? {} : { stopMs: opts.stop }) },
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = { ...object(`built-${n}`), model: 'part.py' }
    let all = ''
    made.on('data', (m) => (all += m.data))
    const seen: SessionStatus[] = []
    made.on('status', (m) => seen.push(m.status))
    const { sessionId } = await made.start(obj, {})
    if (!opts.chat) await expect.poll(() => all).toMatch(READY_LINE)
    const post = async (event: string, body: unknown) => (await fetch(server.url(`/hooks/${sessionId}/${event}`), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: as(sessionId) })).json()
    const edit = (file = join(obj.dir, 'part.py'), tool = 'Edit') => post('PostToolUse', { tool_name: tool, tool_use_id: 'toolu_1', tool_input: { file_path: file } })
    /** The agent begins to edit the model: what a build begun after it is the turn's. */
    const changes = (file = join(obj.dir, 'part.py')) => post('PreToolUse', { tool_name: 'Edit', tool_use_id: 'toolu_c', tool_input: { file_path: file } })
    return { obj, sessionId, post, edit, changes, seen, sessions: made }
  }
  const ok = (objectId: string, revision: number): BuildState => ({ objectId, status: 'ok', revision, stale: false })
  const building = (objectId: string, revision: number): BuildState => ({ objectId, status: 'building', revision, startedAt: Date.now(), stale: true })
  const failed = (objectId: string, revision: number): BuildState => ({ objectId, status: 'failed', revision, error: { kind: 'exception', message: 'NameError: x' }, stale: true })
  const context = (text: string) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })
  /** The scene of a build of one plate, with what a test says is otherwise. */
  const sceneOf = (more: object = {}): Scene =>
    ({ model: 'part.py', layouts: ['assembly'], seconds: 0.1, output: '', parts: [{ key: 'assembly:plate', name: 'plate', layout: 'assembly', bbox: { min: [0, 0, 0], max: [20, 20, 2] }, volume: 800, faceCount: 6, edgeCount: 12, valid: true, solids: 1, volumeExact: true, bboxExact: true, hash: `shape${JSON.stringify(more)}`, loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, ...more }] }) as unknown as Scene
  /** The last successful build a test keeps: its revision, and a plate that is thinner after the first. */
  const keptAs = (revision: number) => ({ revision, scene: sceneOf(revision > 7 ? { volume: 700, faceCount: 7 } : {}) })
  /** What a Stop is held back with when a build of the turn was not looked at. */
  const UNLOOKED = (revision: number): { decision: 'block'; reason: string } => ({ decision: 'block', reason: `r${revision} was built during this turn, and you have not looked at it since. Call mcp__torno__look before finishing.` })
  /** The agent looks, as its hooks tell it. */
  const looks = async (post: (event: string, body: unknown) => Promise<unknown>): Promise<void> => {
    await post('PreToolUse', { tool_name: 'mcp__torno__look', tool_input: {} })
    await post('PostToolUse', { tool_name: 'mcp__torno__look', tool_input: {} })
  }
  /** A build that begins and ends, as a save of the file makes it, whoever wrote the file. */
  const builds = (objectId: string, from: number, to: number): void => {
    land(building(objectId, from))
    land(ok(objectId, to))
  }
  const REVISIONS = (verdicts: Array<[number, Array<[string, 'pass' | 'fail' | 'none']>]>) => {
    const kept = new Map(verdicts.map(([revision, list]) => [revision, new Map(list)]))
    return (_id: string, revision: number | undefined): BuildVerdicts | undefined => (revision === undefined ? undefined : kept.get(revision))
  }

  it('says the prompt a turn answers while it runs, without its words, and none between turns (#336)', async () => {
    const { obj, post, sessions: s } = await begun({ grace: 200 })
    const conversation = '0a1b2c3d-0000-4000-8000-000000000002'
    expect(s.turnNow(obj.id)).toBeUndefined()
    await post('UserPromptSubmit', { prompt: 'put the box on the arm', session_id: conversation })
    expect(s.turnNow(obj.id)).toEqual({ conversation, prompt: `t-${conversation}-1` })
    expect(s.turnNow('nowhere')).toBeUndefined()
    await post('Stop', {})
    expect(s.turnNow(obj.id)).toBeUndefined()
  })

  it("names the prompt of a terminal's write by its number and words, and claims nothing for a tool between whose hooks it was not", async () => {
    const { obj, post, sessions: s } = await begun({ grace: 200 })
    const conversation = '0a1b2c3d-0000-4000-8000-000000000001'
    const part = join(obj.dir, 'part.py')
    const edit = { tool_name: 'Edit', tool_use_id: 'toolu_c', tool_input: { file_path: part } }
    writeFileSync(part, 'W = 1\n')
    await post('UserPromptSubmit', { prompt: 'make the lid taller', session_id: conversation })
    // A turn at work says nothing of who saved.
    expect(s.wroteBy(obj.id, part)).toBeUndefined()
    await post('PreToolUse', edit)
    expect(s.wroteBy(obj.id, part)).toEqual({ turn: { conversation, prompt: `t-${conversation}-1`, text: 'make the lid taller' } })
    expect(s.wroteBy('nowhere', part)).toBeUndefined()
    // A call that never says it ended (a terminal has no stream to say one failed) ends with the turn.
    await post('Stop', {})
    writeFileSync(part, 'W = 1  # mine\n')
    expect(s.wroteBy(obj.id, part)).toBeUndefined()
    // The next prompt is the next number, and its text is cut to what a line of the history holds.
    await post('UserPromptSubmit', { prompt: 'x'.repeat(300), session_id: conversation })
    await post('PreToolUse', edit)
    expect(s.wroteBy(obj.id, part)).toEqual({ turn: { conversation, prompt: `t-${conversation}-2`, text: 'x'.repeat(200) } })
  })

  it.each([
    ["the person's alone, which is then not the turn's", { made: { cause: 'person' as const } }, true],
    ["of the person's Params", { reason: 'params' as const }, true],
    ["Claude's", { made: { cause: 'agent' as const } }, undefined]
  ])("keeps under a tool's card whether its build was %s", async (_which, whose, byPerson) => {
    const { obj, sessionId, sessions: s } = await begun({ chat: true, grace: 3000 })
    const part = join(obj.dir, 'part.py')
    s.prompt(sessionId, [{ type: 'text', text: 'write part.py W' }])
    // Written between the tool's hooks: the build begins while its `PostToolUse` waits for one.
    await expect.poll(() => existsSync(part), { interval: 5 }).toBe(true)
    land({ ...building(obj.id, 2), ...whose })
    land({ ...ok(obj.id, 3), ...whose })
    const put = () => s.history(sessionId)!.items.find((i) => i.kind === 'context' && i.forTool) as Extract<ChatItem, { kind: 'context' }> | undefined
    await expect.poll(put, { timeout: 5000 }).toBeDefined()
    expect(put()!.byPerson).toBe(byPerson)
  })

  it.each([
    ["the next prompt of a terminal's", async (b: Awaited<ReturnType<typeof begun>>) => void (await b.post('UserPromptSubmit', { prompt: 'never mind' }))],
    ['the end of the session', async (b: Awaited<ReturnType<typeof begun>>) => b.sessions.stop(b.sessionId)]
  ])('ends a call that never said it ended (a terminal turn interrupted) at %s', async (_at, ends) => {
    const b = await begun()
    const part = join(b.obj.dir, 'part.py')
    await b.post('UserPromptSubmit', { prompt: 'generate it' })
    await b.post('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'python gen.py' } })
    await ends(b)
    await new Promise((done) => setTimeout(done, 40))
    writeFileSync(part, 'mine')
    expect(b.sessions.wroteBy(b.obj.id, part)).toBeUndefined()
  })

  it("says whose a tool's build was from the build that tool's answer waited for, not one that landed while it was measured", async () => {
    let landed: (() => void) | undefined
    const { obj, sessionId, sessions: s } = await begun({ chat: true, grace: 3000, settled: async () => landed?.() })
    const part = join(obj.dir, 'part.py')
    // While the dimensions of Claude's build are measured, a save of the person's is built.
    landed = () => {
      landed = undefined
      land({ ...building(obj.id, 3), made: { cause: 'person' } })
      land({ ...ok(obj.id, 4), made: { cause: 'person' } })
    }
    s.prompt(sessionId, [{ type: 'text', text: 'write part.py W' }])
    await expect.poll(() => existsSync(part), { interval: 5 }).toBe(true)
    land({ ...building(obj.id, 2), made: { cause: 'agent' } })
    land({ ...ok(obj.id, 3), made: { cause: 'agent' } })
    const put = () => s.history(sessionId)!.items.find((i) => i.kind === 'context' && i.forTool) as Extract<ChatItem, { kind: 'context' }> | undefined
    await expect.poll(put, { timeout: 5000 }).toBeDefined()
    expect(put()!.byPerson).toBeUndefined()
  })

  it('takes a Bash that surely writes nothing for no change of the turn, whatever was saved while it ran', async () => {
    let saved: number | null = 1000
    const { obj, post } = await begun({ saved: async () => saved })
    await post('UserPromptSubmit', { prompt: 'wait for me' })
    await post('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'sleep 5' } })
    saved = 2000
    land(building(obj.id, 1))
    land(ok(obj.id, 2))
    expect(await post('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'sleep 5' } })).toEqual({})
    expect(await post('Stop', {})).toEqual({})
  })

  it('answers an edit of the model with the build it started, once that build has ended', async () => {
    const { obj, edit } = await begun()
    const answer = edit()
    setTimeout(() => land(building(obj.id, 2)), 100)
    setTimeout(() => land(ok(obj.id, 3)), 300)
    expect(await answer).toEqual(context('r3 ok'))
  })

  it('answers with the error of a build that failed, of another .py of the object too, and of a Write', async () => {
    const { obj, edit } = await begun()
    const answer = edit(join(obj.dir, 'lib', 'holes.py'), 'Write')
    setTimeout(() => land(building(obj.id, 2)), 50)
    setTimeout(() => land(failed(obj.id, 2)), 150)
    expect(await answer).toEqual(context('BUILD FAILED\nNameError: x'))
  })

  it('answers a build the save started before the hook came', async () => {
    const { obj, post, edit } = await begun()
    expect(await post('PreToolUse', { tool_name: 'Edit', tool_use_id: 'toolu_1', tool_input: { file_path: join(obj.dir, 'part.py') } })).toEqual({})
    land(building(obj.id, 2))
    const answer = edit()
    setTimeout(() => land(ok(obj.id, 3)), 100)
    expect(await answer).toEqual(context('r3 ok'))
  })

  it('answers {} for any other tool, a file that is not Python or not of the object, and an edit that starts no build', async () => {
    const { obj, post, edit } = await begun({ grace: 200 })
    expect(await post('PostToolUse', { tool_name: 'Read', tool_input: { file_path: join(obj.dir, 'part.py') } })).toEqual({})
    expect(await edit(join(obj.dir, 'brief.md'))).toEqual({})
    expect(await edit(join(root, 'elsewhere.py'))).toEqual({})
    expect(await edit(join(obj.dir, '..', 'elsewhere.py'))).toEqual({})
    expect(await post('PostToolUse', 'not json')).toEqual({})
    // Saved as it was: nothing is built, and nothing is waited for past the grace.
    expect(await edit()).toEqual({})
  })

  it('says a build is running rather than let the hook time out', async () => {
    const { obj, edit } = await begun({ wait: 400 })
    const answer = edit()
    setTimeout(() => land(building(obj.id, 3)), 50)
    expect(await answer).toEqual(context('A build is running (r4); call mcp__torno__wait_build to wait for its result.'))
  })

  it('holds a Stop back once after a build of the turn failed, and lets it go with stop_hook_active', async () => {
    const { obj, post, seen, changes } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    land(building(obj.id, 8))
    land(failed(obj.id, 8))
    expect(await post('Stop', {})).toEqual({ decision: 'block', reason: 'The build after r8 failed: NameError: x. Fix it, or say it is still broken.' })
    expect(seen.at(-1)).toBe('working')
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
    expect(seen.at(-1)).toBe('idle')
  })

  it('takes a StopFailure for the end of the turn: idle, answered {}, and never held back', async () => {
    const { obj, post, changes, seen } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    land(building(obj.id, 7))
    land(failed(obj.id, 7))
    expect(seen.at(-1)).toBe('working')
    // A Stop would be held for the build the turn broke; the turn that ended on an error of the API is not.
    expect(await post('StopFailure', { error: 'authentication_failed' })).toEqual({})
    expect(seen.at(-1)).toBe('idle')
    // The turn is over: the next begins afresh, and a Stop of it with no build of its own holds nothing back.
    await post('UserPromptSubmit', { prompt: 'again' })
    expect(seen.at(-1)).toBe('working')
    expect(await post('Stop', {})).toEqual({})
  })

  it('does not hold a Stop back for a build that failed before the turn', async () => {
    const { obj, post } = await begun()
    land(building(obj.id, 8))
    land(failed(obj.id, 8))
    await post('UserPromptSubmit', { prompt: 'what is it?' })
    expect(await post('Stop', {})).toEqual({})
  })

  it('holds a Stop back after an edit no look has seen, and lets it go after a look', async () => {
    const { obj, post, edit } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    let answer = edit()
    setTimeout(() => land(building(obj.id, 8)), 50)
    setTimeout(() => land(ok(obj.id, 9)), 100)
    await answer
    expect(await post('Stop', {})).toEqual(UNLOOKED(9))

    await post('UserPromptSubmit', { prompt: 'again' })
    answer = edit()
    setTimeout(() => land(building(obj.id, 9)), 50)
    setTimeout(() => land(ok(obj.id, 10)), 100)
    await answer
    expect(await post('PreToolUse', { tool_name: 'mcp__torno__look', tool_input: {} })).toEqual({})
    expect(await post('PostToolUse', { tool_name: 'mcp__torno__look', tool_input: {} })).toEqual({})
    expect(await post('Stop', {})).toEqual({})
  })

  it('holds a Stop back for a look once: the second Stop of the turn is let go', async () => {
    const { obj, post, changes } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    builds(obj.id, 8, 9)
    expect(await post('Stop', {})).toEqual(UNLOOKED(9))
    // The same reason is not held for twice.
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
  })

  it('counts a look only if it came after the build that ended last, and a look of a subagent is a look', async () => {
    const { obj, post, changes } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    builds(obj.id, 8, 9)
    await looks(post)
    builds(obj.id, 9, 10)
    expect(await post('Stop', {})).toEqual(UNLOOKED(10))
    await post('UserPromptSubmit', { prompt: 'again' })
    await changes()
    builds(obj.id, 10, 11)
    // The hooks of a subagent's tools are posted by the same session, with the same tool names.
    await post('PostToolUse', { tool_name: 'mcp__torno__look', tool_input: {}, agent_id: 'reviewer' })
    expect(await post('Stop', {})).toEqual({})
  })

  it('holds no Stop back for a look when no build ended in the turn, nor for a build the turn found already ended', async () => {
    const { obj, post } = await begun()
    builds(obj.id, 7, 8)
    await post('UserPromptSubmit', { prompt: 'what is it?' })
    expect(await post('Stop', {})).toEqual({})
  })

  it('holds no Stop back for a build the turn did not cause: one that began before its first edit, or in a turn with no edit (a first build, a save of the person)', async () => {
    const { obj, post, changes } = await begun()
    // A turn with no edit: the object's first build ends in it, ok and then failed, and a save of the person's after it.
    await post('UserPromptSubmit', { prompt: 'what is this?' })
    builds(obj.id, 0, 1)
    expect(await post('Stop', {})).toEqual({})
    land(building(obj.id, 1))
    land(failed(obj.id, 1))
    expect(await post('Stop', {})).toEqual({})
    // A build that began before the turn's first edit, and ends after it.
    await post('UserPromptSubmit', { prompt: 'make it' })
    land(building(obj.id, 1))
    await new Promise((done) => setTimeout(done, 20))
    await changes()
    land(failed(obj.id, 1))
    expect(await post('Stop', {})).toEqual({})
    await post('UserPromptSubmit', { prompt: 'again' })
    land(building(obj.id, 1))
    await new Promise((done) => setTimeout(done, 20))
    await changes()
    land(ok(obj.id, 2))
    expect(await post('Stop', {})).toEqual({})
  })

  it('holds a Stop back for the build the turn caused: one that began after its first edit, failed or not looked at', async () => {
    const { obj, post, changes } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    land(building(obj.id, 1))
    land(ok(obj.id, 2))
    await new Promise((done) => setTimeout(done, 20))
    await changes()
    await new Promise((done) => setTimeout(done, 20))
    land(building(obj.id, 2))
    land(failed(obj.id, 2))
    expect(await post('Stop', {})).toEqual({ decision: 'block', reason: 'The build after r2 failed: NameError: x. Fix it, or say it is still broken.' })
    land(building(obj.id, 2))
    land(ok(obj.id, 3))
    expect(await post('Stop', { stop_hook_active: true })).toEqual(UNLOOKED(3))
  })

  it('neither waits for a build it did not cause nor holds a Stop back for one still running', async () => {
    const { obj, post, changes } = await begun({ stop: 5000 })
    await post('UserPromptSubmit', { prompt: 'what is this?' })
    land(building(obj.id, 0))
    const begunAt = Date.now()
    expect(await post('Stop', {})).toEqual({})
    expect(Date.now() - begunAt).toBeLessThan(1000)
    // Nor one that began before the turn's first edit.
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    expect(await post('Stop', {})).toEqual({})
    expect(Date.now() - begunAt).toBeLessThan(2000)
  })

  it('takes a Bash that rewrote a source for a change of the turn, and one that did not for none', async () => {
    let saved: number | null = 1000
    const { obj, post } = await begun({ saved: async () => saved })
    const bash = async (id: string, rewrites: boolean, then: () => void) => {
      await post('PreToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'cat > part.py' } })
      if (rewrites) saved = (saved ?? 0) + 1
      then()
      await post('PostToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'cat > part.py' } })
    }
    // Not a rewrite: a build begun while the command ran (the first build, a save of the person's) is not the turn's.
    await post('UserPromptSubmit', { prompt: 'look around' })
    await bash('toolu_1', false, () => builds(obj.id, 0, 1))
    expect(await post('Stop', {})).toEqual({})
    // A rewrite: the build it started is.
    await post('UserPromptSubmit', { prompt: 'make it' })
    await bash('toolu_2', true, () => builds(obj.id, 1, 2))
    expect(await post('Stop', {})).toEqual(UNLOOKED(2))
    await post('UserPromptSubmit', { prompt: 'and now' })
    await bash('toolu_3', true, () => {
      land(building(obj.id, 2))
      land(failed(obj.id, 2))
    })
    expect(await post('Stop', {})).toEqual({ decision: 'block', reason: 'The build after r2 failed: NameError: x. Fix it, or say it is still broken.' })
  })

  it('answers an edit of common/ as one of the project\'s own, an edit of any other file with nothing, and refuses a write of a file of another project even when the build imports it', async () => {
    const { obj, edit, post } = await begun({ grace: 200, uses: ['other/helper.py'] })
    const root = dirname(obj.dir)
    const file = join(root, 'common', 'shared.py')
    expect(await post('PreToolUse', { tool_name: 'Write', tool_use_id: 'toolu_1', tool_input: { file_path: file } })).toEqual({})
    builds(obj.id, 1, 2)
    expect(await edit(file, 'Write')).toEqual(context('r2 ok'))
    const denied = await post('PreToolUse', { tool_name: 'Write', tool_use_id: 'toolu_2', tool_input: { file_path: join(root, 'other', 'helper.py') } })
    expect(denied.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
    expect(await edit(join(root, 'other', 'unrelated.py'), 'Write')).toEqual({})
  })

  it('tells a Bash that rewrote a source the build it started, and one that did not nothing', async () => {
    let saved: number | null = 1000
    const { obj, post } = await begun({ saved: async () => saved, grace: 200 })
    const bash = async (id: string, rewrites: boolean) => {
      await post('PreToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'python edit.py' } })
      if (rewrites) {
        saved = (saved ?? 0) + 1
        builds(obj.id, 1, 2)
      }
      return post('PostToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'python edit.py' } })
    }
    expect(await bash('toolu_1', false)).toEqual({})
    expect(await bash('toolu_2', true)).toEqual(context('r2 ok'))
  })

  it('takes the same shapes in the same places for the look: a change in any part asks for one, a moved hole too', async () => {
    let kept = { revision: 3, scene: sceneOf() }
    const { obj, post, changes } = await begun({ scene: () => kept })
    // A comment, a rename: the same parts.
    await post('UserPromptSubmit', { prompt: 'comment it' })
    await changes()
    kept = { revision: 4, scene: sceneOf() }
    builds(obj.id, 3, 4)
    expect(await post('Stop', {})).toEqual({})
    // A hole: a volume and a face count.
    await post('UserPromptSubmit', { prompt: 'drill it' })
    await changes()
    kept = { revision: 5, scene: sceneOf({ volume: 700, faceCount: 7 }) }
    builds(obj.id, 4, 5)
    expect(await post('Stop', {})).toEqual(UNLOOKED(5))
    // A hole moved: the same volume, box and counts, another shape. A part moved without changing is no different.
    await post('UserPromptSubmit', { prompt: 'move the hole' })
    await changes()
    kept = { revision: 6, scene: sceneOf({ volume: 700, faceCount: 7, hash: 'hole moved' }) }
    builds(obj.id, 5, 6)
    expect(await post('Stop', {})).toEqual(UNLOOKED(6))
    await post('UserPromptSubmit', { prompt: 'move the part' })
    await changes()
    kept = { revision: 7, scene: sceneOf({ volume: 700, faceCount: 7, hash: 'hole moved', loc: { t: [5, 0, 0], q: [0, 0, 0, 1] } }) }
    builds(obj.id, 6, 7)
    expect(await post('Stop', {})).toEqual(UNLOOKED(7))
    // A turn that began with no build has nothing to compare to: it looks.
    kept = undefined as never
    await post('UserPromptSubmit', { prompt: 'first build' })
    await changes()
    kept = { revision: 8, scene: sceneOf() }
    builds(obj.id, 7, 8)
    expect(await post('Stop', {})).toEqual(UNLOOKED(8))
  })

  it('holds a Stop back once for a good build after the failed one it was held for, and for no third reason', async () => {
    let kept = { revision: 7, scene: sceneOf() }
    const verdicts = REVISIONS([
      [7, [['M4', 'pass']]],
      [9, [['M4', 'fail']]]
    ])
    const { obj, post, seen, changes } = await begun({ scene: () => kept, verdicts })
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    land(building(obj.id, 7))
    land(failed(obj.id, 7))
    expect(await post('Stop', {})).toEqual({ decision: 'block', reason: 'The build after r7 failed: NameError: x. Fix it, or say it is still broken.' })
    // Fixed, with a part that came apart, a dimension broken and nobody looking: the second hold is the defect (and says so of the look),
    // the third reason is not held for.
    kept = { revision: 9, scene: sceneOf({ solids: 2 }) }
    builds(obj.id, 7, 9)
    expect(await post('Stop', { stop_hook_active: true })).toEqual({
      decision: 'block',
      reason: 'r9, built in this turn, has what a sound part never has: plate is 2 solids (was 1). Mend the model, or say why it is meant. You have not looked at it either: call mcp__torno__look.'
    })
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
    expect(seen.at(-1)).toBe('idle')
  })

  it('holds a Stop back once for a good build after a failed one the agent mended, which nobody looked at', async () => {
    const { obj, post, changes } = await begun()
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    land(building(obj.id, 7))
    land(failed(obj.id, 7))
    expect((await post('Stop', {})) as { reason: string }).toMatchObject({ reason: expect.stringContaining('failed') })
    builds(obj.id, 7, 8)
    expect(await post('Stop', { stop_hook_active: true })).toEqual(UNLOOKED(8))
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
  })

  it('holds a Stop back for a dimension the turn broke, and for no other: not one that failed before, nor one that was not there', async () => {
    const verdicts = REVISIONS([
      [7, [['M4', 'pass'], ['M5', 'fail'], ['M6', 'pass'], ['M7', 'none']]],
      [9, [['M4', 'fail'], ['M5', 'fail'], ['M6', 'pass'], ['M7', 'fail'], ['M8', 'fail']]]
    ])
    const detail = vi.fn(async (_id: string, _mark: string, _revision: number) => '6 mm, expected 8 ± 0.05')
    const settled = vi.fn(async () => {})
    let kept = keptAs(7)
    const { obj, post, changes } = await begun({ verdicts, detail, settled, scene: () => kept })
    land(ok(obj.id, 7))
    await post('UserPromptSubmit', { prompt: 'make it thinner' })
    await changes()
    kept = keptAs(9)
    builds(obj.id, 7, 9)
    await looks(post)
    expect(await post('Stop', {})).toEqual({
      decision: 'block',
      reason: 'M4 passed on r7 and fails on r9 (6 mm, expected 8 ± 0.05). Fix it, or say why it must change.'
    })
    expect(detail).toHaveBeenCalledWith(obj.id, 'M4', 9)
    expect(detail).toHaveBeenCalledTimes(1)
    // The dimensions are measured on the build before it is judged.
    expect(settled).toHaveBeenCalledWith(obj.id, 9, expect.any(Number))
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
  })

  it('names the dimensions the turn broke, several, in the plural; and without a value says only that it fails', async () => {
    const verdicts = REVISIONS([
      [7, [['M4', 'pass'], ['M5', 'pass']]],
      [9, [['M4', 'fail'], ['M5', 'fail']]]
    ])
    let kept = keptAs(7)
    const { obj, post, changes } = await begun({ verdicts, detail: async (_id, mark) => (mark === 'M4' ? '6 mm, expected 8 ± 0.05' : undefined), scene: () => kept })
    land(ok(obj.id, 7))
    await post('UserPromptSubmit', { prompt: 'thinner' })
    await changes()
    kept = keptAs(9)
    builds(obj.id, 7, 9)
    await looks(post)
    expect(await post('Stop', {})).toEqual({
      decision: 'block',
      reason: 'M4 passed on r7 and fails on r9 (6 mm, expected 8 ± 0.05); M5 passed on r7 and fails on r9. Fix them, or say why they must change.'
    })
  })

  it('holds no Stop back for a dimension the person broke: their save before the agent edited anything', async () => {
    const verdicts = REVISIONS([
      [7, [['M4', 'pass']]],
      [9, [['M4', 'fail']]]
    ])
    const settled = vi.fn(async () => {})
    let kept = keptAs(7)
    const { obj, post } = await begun({ verdicts, settled, scene: () => kept })
    land(ok(obj.id, 7))
    await post('UserPromptSubmit', { prompt: 'is M4 still right?' })
    // The person saves their own change in an editor while the agent reads: no edit of the turn's.
    kept = keptAs(9)
    builds(obj.id, 7, 9)
    await looks(post)
    expect(await post('Stop', {})).toEqual({})
    // Nor is the dimension waited for: there is nothing the turn would be held to.
    expect(settled).not.toHaveBeenCalled()
  })

  it('holds a Stop back for the dimension with the look it still lacks, and counts both reasons as held', async () => {
    const verdicts = REVISIONS([
      [7, [['M4', 'pass']]],
      [9, [['M4', 'fail']]]
    ])
    let kept = keptAs(7)
    const { obj, post, changes } = await begun({ verdicts, scene: () => kept })
    land(ok(obj.id, 7))
    await post('UserPromptSubmit', { prompt: 'thinner' })
    await changes()
    kept = keptAs(9)
    builds(obj.id, 7, 9)
    expect(await post('Stop', {})).toEqual({
      decision: 'block',
      reason: 'M4 passed on r7 and fails on r9. Fix it, or say why it must change. You have not looked at it either: call mcp__torno__look.'
    })
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
  })

  it('does not wait for the dimensions when none passed when the turn began', async () => {
    const settled = vi.fn(async () => {})
    let kept = keptAs(7)
    const { obj, post } = await begun({ verdicts: REVISIONS([[7, [['M4', 'fail']]]]), settled, scene: () => kept })
    land(ok(obj.id, 7))
    await post('UserPromptSubmit', { prompt: 'thinner' })
    kept = keptAs(9)
    builds(obj.id, 7, 9)
    await looks(post)
    expect(await post('Stop', {})).toEqual({})
    expect(settled).not.toHaveBeenCalled()
  })

  it('waits for a build that runs, then judges its result', async () => {
    const { obj, post, changes } = await begun({ stop: 3000 })
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    land(building(obj.id, 7))
    setTimeout(() => land(failed(obj.id, 7)), 150)
    const begunAt = Date.now()
    expect(await post('Stop', {})).toEqual({ decision: 'block', reason: 'The build after r7 failed: NameError: x. Fix it, or say it is still broken.' })
    expect(Date.now() - begunAt).toBeGreaterThanOrEqual(140)
    expect(Date.now() - begunAt).toBeLessThan(2500)
  })

  it('holds a Stop back once for a build still running after the wait, and lets the next go', async () => {
    const { obj, post, changes } = await begun({ stop: 250 })
    await post('UserPromptSubmit', { prompt: 'make it' })
    await changes()
    land(building(obj.id, 7))
    expect(await post('Stop', {})).toEqual({
      decision: 'block',
      reason: 'A build begun in this turn is still running (r8). Call mcp__torno__wait_build for its result, then mcp__torno__look, before finishing.'
    })
    // Told once: the next does not wait the wait again.
    const again = Date.now()
    expect(await post('Stop', { stop_hook_active: true })).toEqual({})
    expect(Date.now() - again).toBeLessThan(150)
  })

  it('does not wait for a build that began before the turn', async () => {
    const { obj, post } = await begun({ stop: 5000 })
    land(building(obj.id, 7))
    await new Promise((done) => setTimeout(done, 20))
    await post('UserPromptSubmit', { prompt: 'what is it?' })
    const begunAt = Date.now()
    expect(await post('Stop', {})).toEqual({})
    expect(Date.now() - begunAt).toBeLessThan(1000)
  })

  it('reads a Write of the stand-in: the file is written between the hooks, the build is told, and a Stop it ends the turn with is held for a look', async () => {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      build: (id) => states.get(id),
      buildContextFor: (id) => told(id),
      editTiming: { answerMs: 5000, graceMs: 1500 },
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = { ...object(`written-${n}`), model: 'part.py' }
    const messages: StreamMessage[] = []
    made.on('stream', (m) => messages.push(m.message))
    const { sessionId } = await made.start(obj, {})
    // The watcher: the save begins a build and the build ends.
    let seenFile = false
    const timer = setInterval(() => {
      if (seenFile || !existsSync(join(obj.dir, 'part.py'))) return
      seenFile = true
      land(building(obj.id, 2))
      setTimeout(() => land(ok(obj.id, 3)), 100)
    }, 10)
    try {
      made.prompt(sessionId, [{ type: 'text', text: 'write part.py x = 1\\ny = 2' }])
      await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(1)
    } finally {
      clearInterval(timer)
    }
    expect(readFileSync(join(obj.dir, 'part.py'), 'utf8')).toBe('x = 1\ny = 2')
    const hooked = messages.filter((m) => m.type === 'system' && m.subtype === 'hook_response' && m.hook_event !== 'UserPromptSubmit').map((m) => `${m.hook_event}: ${m.output}`)
    expect(hooked).toEqual(['PostToolUse: r3 ok', `Stop: ${UNLOOKED(3).reason}`])
  })

  it('refuses a Write or Edit of the stand-in outside the project and the workspace\'s common/, with a reason it reads, and lets the project\'s own files and common/ through', async () => {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = object(`reach-a-${n}`)
    const sibling = object(`reach-b-${n}`)
    mkdirSync(join(root, 'common'), { recursive: true })
    writeFileSync(join(sibling.dir, 'part.py'), 'W = 1\n')
    writeFileSync(join(root, 'common', 'shared.py'), 'W = 1\n')
    const messages: StreamMessage[] = []
    made.on('stream', (m) => messages.push(m.message))
    const { sessionId } = await made.start(obj, {})
    const script = [
      'write own.py x = 1',
      `write ../${sibling.id}/new.py x = 1`,
      `edit ../${sibling.id}/part.py "W = 1" "W = 2"`,
      `write ../top-${n}.py x = 1`,
      `write ../newfolder-${n}/model.py x = 1`,
      'edit ../common/shared.py "W = 1" "W = 2"',
      'write .torno/marks.json {}'
    ].join('\n')
    made.prompt(sessionId, [{ type: 'text', text: script }])
    await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(1)
    expect(readFileSync(join(obj.dir, 'own.py'), 'utf8')).toBe('x = 1')
    expect(readFileSync(join(root, 'common', 'shared.py'), 'utf8')).toBe('W = 2\n')
    expect(existsSync(join(sibling.dir, 'new.py'))).toBe(false)
    expect(readFileSync(join(sibling.dir, 'part.py'), 'utf8')).toBe('W = 1\n')
    expect(existsSync(join(root, `top-${n}.py`))).toBe(false)
    expect(existsSync(join(root, `newfolder-${n}`))).toBe(false)
    const results = messages.flatMap((m) => (m.type === 'user' ? (m.message as { content: { content?: string; is_error?: boolean }[] }).content : []))
    const refused = results.filter((r) => r.is_error)
    expect(refused).toHaveLength(5)
    expect(refused.slice(0, 4).every((r) => String(r.content).includes(`works on the project in ${obj.dir}`))).toBe(true)
    expect(refused[4].content).toContain('Use add_mark and resolve_mark instead')
    expect(existsSync(join(obj.dir, '.torno', 'marks.json'))).toBe(false)
  })

  it('refuses the stand-in\'s Edit and Write of brief.md, the person\'s own words, and points at add_card (#337)', async () => {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = object(`brief-${n}`)
    writeFileSync(join(obj.dir, 'brief.md'), '# box\n\nA box.\n')
    const messages: StreamMessage[] = []
    made.on('stream', (m) => messages.push(m.message))
    const { sessionId } = await made.start(obj, {})
    made.prompt(sessionId, [{ type: 'text', text: ['edit brief.md "A box." "A box. Mount: a blade."', 'write brief.md mine now'].join('\n') }])
    await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(1)
    expect(readFileSync(join(obj.dir, 'brief.md'), 'utf8')).toBe('# box\n\nA box.\n')
    const results = messages.flatMap((m) => (m.type === 'user' ? (m.message as { content: { content?: string; is_error?: boolean }[] }).content : []))
    const refused = results.filter((r) => r.is_error)
    expect(refused).toHaveLength(2)
    expect(refused.every((r) => String(r.content).includes('may not write brief.md') && String(r.content).includes('add_card'))).toBe(true)
  })

  it('lets the stand-in edit brief.md in the one turn whose prompt asked it to move its old sections out, and in no other (#341)', async () => {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    let asks = 1
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      // The first prompt carries the ask, as the board line gives it once; the next does not.
      contextFor: () => (asks-- > 0 ? { text: 'brief.md holds sections you wrote into it before.', sentMarkIds: [], briefMove: true } : { text: '', sentMarkIds: [] }),
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = object(`move-${n}`)
    writeFileSync(join(obj.dir, 'brief.md'), '# box\n\nA box.\n\n## Answers\n\n- Mount: a blade\n')
    const messages: StreamMessage[] = []
    made.on('stream', (m) => messages.push(m.message))
    const { sessionId } = await made.start(obj, {})
    made.prompt(sessionId, [{ type: 'text', text: 'edit brief.md "## Answers" "## Kept"' }])
    await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(1)
    expect(readFileSync(join(obj.dir, 'brief.md'), 'utf8')).toContain('## Kept')
    made.prompt(sessionId, [{ type: 'text', text: 'edit brief.md "## Kept" "## Again"' }])
    await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(2)
    expect(readFileSync(join(obj.dir, 'brief.md'), 'utf8')).toContain('## Kept')
    const refused = messages.flatMap((m) => (m.type === 'user' ? (m.message as { content: { content?: string; is_error?: boolean }[] }).content : [])).filter((r) => r.is_error)
    expect(refused).toHaveLength(1)
    expect(String(refused[0].content)).toContain('may not write brief.md')
  })

  it('reads an Edit of the stand-in, and puts the build it started under the edit as data: how long a good one took, the last line of what a failed one said', async () => {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      build: (id) => states.get(id),
      buildContextFor: (id) => told(id),
      editTiming: { answerMs: 5000, graceMs: 1500 },
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = { ...object(`edited-${n}`), model: 'part.py' }
    mkdirSync(obj.dir, { recursive: true })
    writeFileSync(join(obj.dir, 'part.py'), 'W = 1\nH = 2\n')
    const messages: StreamMessage[] = []
    made.on('stream', (m) => messages.push(m.message))
    const { sessionId } = await made.start(obj, {})
    // The watcher: a save of the file begins a build, which ends as `outcomes` says of the text saved. Only a whole
    // text is a save: the stand-in writes from its own process, and a read between the truncate and the write finds
    // the file empty or in part.
    const outcomes = new Map<string, BuildState>([
      ['W = 2\nH = 2\n', { ...ok(obj.id, 2), seconds: 1.5 }],
      ['W = WAL\nH = 2\n', { ...failed(obj.id, 2), error: { kind: 'exception', message: "name 'WAL' is not defined", traceback: 'Traceback (most recent call last):\n  File "part.py", line 1\nNameError: name \'WAL\' is not defined\n' } }]
    ])
    const timer = setInterval(() => {
      const text = readFileSync(join(obj.dir, 'part.py'), 'utf8')
      const outcome = outcomes.get(text)
      if (!outcome) return
      outcomes.delete(text)
      land(building(obj.id, 1))
      setTimeout(() => land(outcome), 100)
    }, 10)
    try {
      made.prompt(sessionId, [{ type: 'text', text: 'edit part.py "W = 1" "W = 2"' }])
      await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(1)
      made.prompt(sessionId, [{ type: 'text', text: 'edit part.py "W = 2" "W = WAL"' }])
      await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(2)
    } finally {
      clearInterval(timer)
    }
    expect(readFileSync(join(obj.dir, 'part.py'), 'utf8')).toBe('W = WAL\nH = 2\n')
    const items = made.history(sessionId)!.items
    const cards = items.filter((i) => i.kind === 'tool')
    expect(cards).toMatchObject([{ name: 'Edit', input: { old_string: 'W = 1', new_string: 'W = 2' } }, { name: 'Edit' }])
    expect(items.filter((i) => i.kind === 'context')).toMatchObject([
      { forTool: true, forUser: cards[0].id, buildState: 'ok', revision: 2, seconds: 1.5 },
      { forTool: true, forUser: cards[1].id, buildState: 'failed', revision: 2, error: "NameError: name 'WAL' is not defined" }
    ])
    // Only a good build has the time, and only a failed one the error.
    const [good, bad] = items.filter((i) => i.kind === 'context')
    expect(good).not.toHaveProperty('error')
    expect(bad).not.toHaveProperty('seconds')
  })

  it('says of an edit the failure of its own build, not of a newer one that began while its context was made', async () => {
    states = new Map()
    own = recording(await startHttp())
    const server = own
    made = new Sessions({
      configDir,
      http: server,
      adapter: claudeAdapter(`node ${FAKE}`),
      viewFor: () => 'chat',
      contextFor: () => ({ text: '', sentMarkIds: [] }),
      build: (id) => states.get(id),
      // The context takes its time, as it does with a dimension to measure: a save lands meanwhile and fails differently.
      buildContextFor: async (id) => {
        const said = told(id)
        await new Promise((done) => setTimeout(done, 300))
        return said
      },
      editTiming: { answerMs: 5000, graceMs: 1500 },
      systemPromptFor: () => '',
      mcpUrlFor: (id) => server.url(`/mcp/${id}`)
    })
    others.push(made)
    n += 1
    const obj = { ...object(`leak-${n}`), model: 'part.py' }
    mkdirSync(obj.dir, { recursive: true })
    writeFileSync(join(obj.dir, 'part.py'), 'W = 1\n')
    const messages: StreamMessage[] = []
    made.on('stream', (m) => messages.push(m.message))
    const { sessionId } = await made.start(obj, {})
    const error = (message: string): BuildState => ({ ...failed(obj.id, 2), error: { kind: 'exception', message, traceback: `Traceback\n${message}\n` } })
    let seen = false
    const timer = setInterval(() => {
      if (seen || readFileSync(join(obj.dir, 'part.py'), 'utf8') === 'W = 1\n') return
      seen = true
      land(building(obj.id, 2))
      setTimeout(() => land(error('NameError: first')), 100)
      // After the answer began to be made, before it ends.
      setTimeout(() => land(error('NameError: later')), 250)
    }, 10)
    try {
      made.prompt(sessionId, [{ type: 'text', text: 'edit part.py "W = 1" "W = 2"' }])
      await expect.poll(() => messages.filter((m) => m.type === 'result').length, { timeout: 10_000 }).toBe(1)
    } finally {
      clearInterval(timer)
    }
    expect(made.history(sessionId)!.items.filter((i) => i.kind === 'context')).toMatchObject([{ forTool: true, buildState: 'failed', error: 'NameError: first' }])
  })

  it('tells what the build did to the parts, from the real kernel, and holds a Stop back once for a part that came apart', async () => {
    const ws = mkdtempSync(join(realpathSync(tmpdir()), 'torno-sanity-'))
    const kernel = startKernel({ workspaceRoot: ws, hasProject: false, kernelDir: resolve(__dirname, '../../../../kernel') })
    try {
      const model = (name: string, body: string): string => {
        mkdirSync(join(ws, name), { recursive: true })
        writeFileSync(join(ws, name, `${name}.py`), `from dataclasses import dataclass\n\nfrom build123d import Box, Pos\n\n\n@dataclass(frozen=True)\nclass Params:\n    pass\n\n\ndef assembly(p):\n${body}\n`)
        return join(ws, name)
      }
      // A boss meant to stand on the plate, 2 mm above it: the union is two solids, and valid.
      const one = model('whole', '    return {"plate": Box(20, 20, 2) + Pos(0, 0, 3) * Box(4, 4, 4), "lid": Box(10, 10, 1)}')
      const two = model('apart', '    return {"plate": Box(20, 20, 2) + Pos(0, 0, 5) * Box(4, 4, 4), "lid": Box(10, 10, 1)}')
      const builds = [await kernel.build(one, 'whole.py'), await kernel.build(two, 'apart.py')]
      const scenes = builds.map((b, i) => {
        if (!b.ok) throw new Error(`${b.error.kind}: ${b.error.message}`)
        return { revision: i + 1, scene: b.scene as Scene }
      })
      expect(scenes[1].scene.parts.find((p) => p.name === 'plate')).toMatchObject({ solids: 2, valid: true })
      let current: BuildState | undefined
      let kept = scenes.slice(0, 1)
      const deps = (id: string): ContextDeps => ({
        object: () => ({ id, name: id, dir: join(ws, id), model: `${id}.py` }),
        openObjectId: () => id,
        build: () => current,
        scene: () => kept.at(-1),
        scenes: () => kept,
        view: () => undefined
      })
      const { obj, post, edit } = await begun({ context: (id) => buildContextFor(deps(id), id), scene: () => kept.at(-1) })
      current = { objectId: obj.id, status: 'ok', revision: 1, seconds: 0.2, stale: false }
      await post('UserPromptSubmit', { prompt: 'raise the boss' })
      const answer = edit()
      setTimeout(() => land(building(obj.id, 1)), 50)
      setTimeout(() => {
        kept = scenes
        land((current = { objectId: obj.id, status: 'ok', revision: 2, seconds: 0.2, stale: false }))
      }, 200)
      const told = ((await answer) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
      expect(told.split('\n').slice(1, 3)).toEqual([
        'Changed since r1: plate: size 20 × 20 × 6 → 20 × 20 × 8 mm, faces 11 → 12, solids 1 → 2; 1 part unchanged.',
        'Check: plate is 2 solids (was 1); the face or edge numbers of plate may name others now (describe refs again).'
      ])
      expect(await post('Stop', {})).toEqual({
        decision: 'block',
        reason: 'r2, built in this turn, has what a sound part never has: plate is 2 solids (was 1). Mend the model, or say why it is meant. You have not looked at it either: call mcp__torno__look.'
      })
      expect(await post('Stop', { stop_hook_active: true })).toEqual({})
    } finally {
      await kernel.dispose()
      rmSync(ws, { recursive: true, force: true })
    }
  }, 60_000)

  it('tells what the agent expected of an edit in the answer to that edit, once', async () => {
    let kept: { revision: number; scene: Scene } = keptAs(1)
    const store = new Expectations()
    const toolDeps = { scene: () => kept } as unknown as ToolDeps
    // As index.ts makes it: the context of the build, and the verdict of the expectation, by the same function.
    const { obj, post, edit } = await begun({ scene: () => kept, context: async (id) => withExpectation(store, toolDeps, id, told(id)) })
    states.set(obj.id, ok(obj.id, 1))
    store.hold(obj.id, 1, kept.scene, 'assembly', { checks: [{ part: 'plate', volume: { change: -100, tolerance: 1 }, faces: { change: 1 } }, { unchanged: ['plate'] }], note: 'thin it' })
    await post('UserPromptSubmit', { prompt: 'thin the plate' })
    const first = edit()
    setTimeout(() => land(building(obj.id, 1)), 50)
    setTimeout(() => {
      kept = keptAs(8)
      land(ok(obj.id, 8))
    }, 200)
    const text = ((await first) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
    expect(text).toContain('r8 ok\nexpected (r8) "thin it": 2 met, 1 not: plate changed')
    // The next edit's build is told without it: it was told once.
    const second = edit()
    setTimeout(() => land(building(obj.id, 8)), 50)
    setTimeout(() => {
      kept = keptAs(9)
      land(ok(obj.id, 9))
    }, 200)
    const again = ((await second) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
    expect(again).toMatch(/^r9 ok\nNot yet looked at/)
    expect(again).not.toContain('expected')
  })

  it('says in the answer to an edit that its build is not yet looked at, and a number after a small change is a look (#227)', async () => {
    let kept: { revision: number; scene: Scene } = { revision: 7, scene: sceneOf() }
    const { obj, post, edit } = await begun({ scene: () => kept })
    await post('UserPromptSubmit', { prompt: 'make the fit 0.2 mm' })
    const answer = async (revision: number, scene: Scene): Promise<string> => {
      const told = edit()
      setTimeout(() => land(building(obj.id, revision - 1)), 50)
      setTimeout(() => {
        kept = { revision, scene }
        land(ok(obj.id, revision))
      }, 100)
      return ((await told) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext
    }
    // Where the agent reads it before it writes a summary, not only at Stop.
    expect(await answer(8, sceneOf({ volume: 790 }))).toBe(`r8 ok\nNot yet looked at: r8 was built in this turn. Call mcp__torno__look before you write your summary; for a small change that adds or removes no part, mcp__torno__measure, mcp__torno__check or mcp__torno__features on it will do.`)
    // The change is small (no part came or went, no count changed) and a measure confirmed it: nothing is held back.
    await post('PostToolUse', { tool_name: 'mcp__torno__measure', tool_input: {} })
    expect(await post('Stop', {})).toEqual({})
    // A new build after the measure is not confirmed by it.
    await post('UserPromptSubmit', { prompt: 'again' })
    await answer(9, sceneOf({ volume: 780 }))
    await post('PostToolUse', { tool_name: 'mcp__torno__measure', tool_input: {} })
    await answer(10, sceneOf({ volume: 770 }))
    expect(await post('Stop', {})).toEqual(UNLOOKED(10))
  })

  it('does not take a measure for a look when a part came or a face count changed (#227)', async () => {
    let kept: { revision: number; scene: Scene } = { revision: 7, scene: sceneOf() }
    const { obj, post, changes } = await begun({ scene: () => kept })
    await post('UserPromptSubmit', { prompt: 'add a hole' })
    await changes()
    kept = { revision: 8, scene: sceneOf({ faceCount: 9 }) }
    builds(obj.id, 7, 8)
    await post('PostToolUse', { tool_name: 'mcp__torno__measure', tool_input: {} })
    expect(await post('Stop', {})).toEqual(UNLOOKED(8))
  })

  it('holds no Stop back for a defect of the first build of an object, in a turn that edited nothing', async () => {
    let kept: { revision: number; scene: Scene } | undefined
    const { obj, post } = await begun({ scene: () => kept })
    // A question asked before the object's first build has landed: the turn begins with no build to compare to.
    await post('UserPromptSubmit', { prompt: 'why is the plate flagged?' })
    kept = { revision: 1, scene: sceneOf({ valid: false }) }
    builds(obj.id, 0, 1)
    await looks(post)
    expect(await post('Stop', {})).toEqual({})
  })

  it('does not hold a Stop back for a change of volume alone, nor for a defect the turn began with', async () => {
    const sound = (more: object = {}): Scene => ({ model: 'part.py', layouts: ['assembly'], seconds: 0.1, output: '', parts: [{ key: 'assembly:plate', name: 'plate', layout: 'assembly', bbox: { min: [0, 0, 0], max: [20, 20, 2] }, volume: 800, faceCount: 6, edgeCount: 12, valid: true, solids: 1, ...more }] }) as unknown as Scene
    let kept = { revision: 3, scene: sound() }
    const { obj, post, changes } = await begun({ scene: () => kept })
    // The agent's own edits: what holds nothing back is the change and the defect, not who made them.
    await post('UserPromptSubmit', { prompt: 'thinner' })
    await changes()
    kept = { revision: 4, scene: sound({ volume: 200 }) }
    builds(obj.id, 3, 4)
    await looks(post)
    expect(await post('Stop', {})).toEqual({})

    kept = { revision: 5, scene: sound({ valid: false }) }
    await post('UserPromptSubmit', { prompt: 'what is wrong?' })
    await changes()
    builds(obj.id, 4, 6)
    kept = { revision: 6, scene: sound({ valid: false, volume: 700 }) }
    await looks(post)
    expect(await post('Stop', {})).toEqual({})
  })

  it('tells what the model printed, as the real kernel returns it: after a good build and after a failed one', async () => {
    const ws = mkdtempSync(join(realpathSync(tmpdir()), 'torno-printed-'))
    const kernel = startKernel({ workspaceRoot: ws, hasProject: false, kernelDir: resolve(__dirname, '../../../../kernel') })
    try {
      const model = (name: string, body: string): string => {
        mkdirSync(join(ws, name), { recursive: true })
        writeFileSync(join(ws, name, `${name}.py`), `from dataclasses import dataclass\n\nfrom build123d import Box\n\n\n@dataclass(frozen=True)\nclass Params:\n    pass\n\n\ndef assembly(p):\n${body}\n`)
        return join(ws, name)
      }
      const good = model('printer', '    print("solids: 2")\n    print("volume: 3040.5")\n    return {"plate": Box(20, 20, 2)}')
      const bad = model('asserter', '    print("solids: 2")\n    assert False, "one solid expected"\n    return {"plate": Box(20, 20, 2)}')
      const built = await kernel.build(good, 'printer.py')
      const refused = await kernel.build(bad, 'asserter.py')
      if (!built.ok) throw new Error(`${built.error.kind}: ${built.error.message}`)
      if (refused.ok) throw new Error('the model with a failed assert built')
      let current: BuildState | undefined
      const deps = (id: string): ContextDeps => ({
        object: () => ({ id, name: id, dir: join(ws, id), model: `${id}.py` }),
        openObjectId: () => id,
        build: () => current,
        scene: () => (built.ok ? { revision: 1, scene: built.scene as Scene } : undefined),
        view: () => undefined
      })
      const { obj, edit } = await begun({ context: (id) => buildContextFor(deps(id), id) })
      const answer = edit()
      setTimeout(() => land(building(obj.id, 0)), 50)
      setTimeout(() => land((current = { objectId: obj.id, status: 'ok', revision: 1, seconds: 0.2, stale: false })), 200)
      const good1 = (await answer) as { hookSpecificOutput: { additionalContext: string } }
      expect(good1.hookSpecificOutput.additionalContext).toMatch(/\nModel printed \(last 2 lines\):\nsolids: 2\nvolume: 3040\.5$/)
      const next = edit()
      setTimeout(() => land(building(obj.id, 1)), 50)
      setTimeout(() => land((current = { objectId: obj.id, status: 'failed', revision: 1, stale: true, error: refused.error })), 200)
      const bad1 = (await next) as { hookSpecificOutput: { additionalContext: string } }
      expect(bad1.hookSpecificOutput.additionalContext).toContain('BUILD FAILED')
      expect(bad1.hookSpecificOutput.additionalContext).toContain('one solid expected')
      expect(bad1.hookSpecificOutput.additionalContext).toMatch(/\nModel printed \(last 1 line\):\nsolids: 2$/)
    } finally {
      await kernel.dispose()
      rmSync(ws, { recursive: true, force: true })
    }
  }, 60_000)
})
