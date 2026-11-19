import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAdapter, HOOK_EVENTS, reviewerAgents, TESTED_CLAUDE, TORNO_PLUGIN } from './claude'

const ctx = {
  sessionId: 's1',
  conversationId: '0b1e5a52-6d0c-4f6e-9a55-2f4a3c1d9e10',
  resume: false,
  view: 'terminal' as const,
  cwd: '/ws/bracket',
  mcpUrl: 'http://127.0.0.1:4100/mcp/bracket',
  hookUrl: (event: string) => `http://127.0.0.1:4100/hooks/s1/${event}`,
  token: 'kQ2v7xT0pZ_session-token-of-forty-three-ch',
  configDir: '/home/p/.config/torno/agent',
  systemPrompt: 'You are in torno.'
}

/** The http hook of an event, as torno registers it: the token comes from the environment, named in `allowedEnvVars`. */
const hookOf = (url: string, event: string) => ({
  type: 'http',
  url,
  timeout: event === 'PostToolUse' ? 60 : event === 'Stop' ? 25 : 5,
  headers: { 'X-Torno-Session': '$TORNO_SESSION' },
  allowedEnvVars: ['TORNO_SESSION']
})

/** The value that follows a flag in an argument list. */
function after(args: string[], flag: string): string {
  const at = args.indexOf(flag)
  expect(at, flag).toBeGreaterThanOrEqual(0)
  return args[at + 1]
}

describe('the Claude Code adapter', () => {
  it('starts on the model and effort chosen for the session, each as one argument with its value, and on the person\'s defaults without', () => {
    const chosen = claudeAdapter().launch({ ...ctx, model: 'opus', effort: 'xhigh' })
    expect(chosen.args).toContain('--model=opus')
    expect(chosen.args).toContain('--effort=xhigh')
    const plain = claudeAdapter().launch(ctx)
    expect(plain.args.some((a) => a.startsWith('--model') || a.startsWith('--effort'))).toBe(false)
  })

  it('launches a new conversation by its id', () => {
    const launch = claudeAdapter().launch(ctx)
    expect(launch.command).toBe('claude')
    expect(after(launch.args, '--session-id')).toBe(ctx.conversationId)
    expect(launch.args).not.toContain('--resume')
    expect(after(launch.args, '--allowedTools')).toBe('mcp__torno__*')
    expect(after(launch.args, '--append-system-prompt')).toBe('You are in torno.')
    expect(launch.args).not.toContain('--strict-mcp-config')
  })

  it('resumes a conversation by its id', () => {
    const launch = claudeAdapter().launch({ ...ctx, resume: true })
    expect(after(launch.args, '--resume')).toBe(ctx.conversationId)
    expect(launch.args).not.toContain('--session-id')
    expect(launch.args).not.toContain('--strict-mcp-config')
  })

  it("names torno's MCP server in a file of torno's own, by its URL, with the placeholder of the token and not the token", () => {
    const launch = claudeAdapter().launch(ctx)
    const path = after(launch.args, '--mcp-config')
    expect(path).toBe('/home/p/.config/torno/agent/s1.mcp.json')
    expect(launch.files.map((file) => file.path)).toEqual([path])
    const text = launch.files[0].text
    expect(JSON.parse(text)).toEqual({ mcpServers: { torno: { type: 'http', url: ctx.mcpUrl, headers: { 'X-Torno-Session': '${TORNO_SESSION}' } } } })
    expect(text).not.toContain(ctx.token)
  })

  // #113: whatever is on a command line every user of the machine can read (`/proc/<pid>/cmdline`, `ps`).
  it("never puts the session's token on its command line: it is in its environment alone, as TORNO_SESSION", () => {
    for (const view of ['terminal', 'chat'] as const) {
      for (const resume of [false, true]) {
        const launch = claudeAdapter('node /abs/fake-agent.mjs', '/p').launch({ ...ctx, view, resume })
        for (const arg of [launch.command, ...launch.args]) expect(arg).not.toContain(ctx.token)
        for (const file of launch.files) expect(file.text).not.toContain(ctx.token)
        expect(launch.env).toEqual({ TORNO_SESSION: ctx.token })
      }
    }
  })

  it('registers an http hook for each event it follows, and no other', () => {
    const settings = JSON.parse(after(claudeAdapter().launch(ctx).args, '--settings'))
    expect(HOOK_EVENTS).toEqual(['UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostCompact', 'SessionEnd'])
    expect(Object.keys(settings)).toEqual(['hooks'])
    expect(Object.keys(settings.hooks)).toEqual(HOOK_EVENTS)
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toEqual([{ hooks: [hookOf(`http://127.0.0.1:4100/hooks/s1/${event}`, event)] }])
    }
  })

  it('leaves the system prompt out when there is none', () => {
    expect(claudeAdapter().launch({ ...ctx, systemPrompt: '' }).args).not.toContain('--append-system-prompt')
  })

  it('runs another command when one is named, split on spaces, with the same arguments', () => {
    const usual = claudeAdapter().launch(ctx)
    const launch = claudeAdapter('node  /abs/fake-agent.mjs ').launch(ctx)
    expect(launch.command).toBe('node')
    expect(launch.args).toEqual(['/abs/fake-agent.mjs', ...usual.args])
    expect(claudeAdapter('   ').launch(ctx).command).toBe('claude')
  })

  it('passes its arguments as a list, each one string, to the letter as before there was another agent', () => {
    const spaced = { ...ctx, cwd: '/ws/my parts/lid 2', mcpUrl: 'http://127.0.0.1:4100/mcp/lid%202', agentDir: '/ws/my parts/lid 2/.torno/agent', systemPrompt: 'You are in torno. Mind the "quotes" and $HOME.' }
    const launch = claudeAdapter().launch(spaced)
    expect(launch.args).toEqual([
      '--session-id',
      ctx.conversationId,
      '--mcp-config',
      // Since #113 a file of torno's: what it holds is above.
      '/home/p/.config/torno/agent/s1.mcp.json',
      '--allowedTools',
      'mcp__torno__*',
      '--settings',
      JSON.stringify({ hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [hookOf(`http://127.0.0.1:4100/hooks/s1/${event}`, event)] }]])) }),
      // Added since (#6): the reviewer subagent.
      '--agents',
      JSON.stringify(reviewerAgents((tool) => `mcp__torno__${tool}`)),
      '--append-system-prompt',
      'You are in torno. Mind the "quotes" and $HOME.'
    ])
    // It adds the token to the environment, and nothing else.
    expect(launch.env).toEqual({ TORNO_SESSION: ctx.token })
  })

  it('is the terminal one plus the flags of the headless mode in chat, `-p` first after what the command brings', () => {
    const terminal = claudeAdapter().launch(ctx).args
    const chat = claudeAdapter().launch({ ...ctx, view: 'chat' }).args
    const flags = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio']
    expect(chat).toEqual([...flags, ...terminal])
    expect(chat.indexOf('-p')).toBe(0)
    // The same with a command that brings arguments of its own: they stay in front.
    const fake = claudeAdapter('node /abs/fake-agent.mjs').launch({ ...ctx, view: 'chat' }).args
    expect(fake.slice(0, 3)).toEqual(['/abs/fake-agent.mjs', '-p', '--input-format'])
    // Resumed, it is the same conversation by the same flag.
    expect(after(claudeAdapter().launch({ ...ctx, view: 'chat', resume: true }).args, '--resume')).toBe(ctx.conversationId)
  })

  it('says the command it is looked for by, and how it names a tool', () => {
    const adapter = claudeAdapter('node /abs/fake-agent.mjs')
    expect([adapter.command, adapter.toolName('scene')]).toEqual(['claude', 'mcp__torno__scene'])
  })

  // #4: torno's skills, a plugin that ships with the app, loaded for this session only.
  it("loads torno's plugin of skills by its folder, for this session only, when it is given one", () => {
    const launch = claudeAdapter(undefined, '/opt/torno/resources/agent-plugin').launch(ctx)
    expect(after(launch.args, '--plugin-dir')).toBe('/opt/torno/resources/agent-plugin')
    expect(claudeAdapter(undefined, '/opt/torno/resources/agent-plugin').skills).toBe(true)
    // In chat too: the same arguments after the headless ones.
    expect(after(claudeAdapter(undefined, '/p').launch({ ...ctx, view: 'chat' }).args, '--plugin-dir')).toBe('/p')
    expect(claudeAdapter().launch(ctx).args).not.toContain('--plugin-dir')
    expect(claudeAdapter().skills).toBe(false)
  })

  // #116: what the chat reads of the CLI's init is held to what torno passed it.
  it("names the plugin it passes and the versions it was checked with, and leaves the plugin out when asked", () => {
    const adapter = claudeAdapter(undefined, '/p')
    expect(adapter.plugin).toEqual(TORNO_PLUGIN)
    expect(claudeAdapter().plugin).toBeUndefined()
    // The skills the plugin holds are the folders under resources/agent-plugin/skills, and the manifest names it.
    const root = join(__dirname, '../../../resources/agent-plugin')
    expect(TORNO_PLUGIN.name).toBe(JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).name)
    expect([...TORNO_PLUGIN.skills].sort()).toEqual(readdirSync(join(root, 'skills')).sort())
    // The fixtures are the CLI as torno was checked against it.
    for (const file of ['claude-stream.jsonl', 'claude-stream-asks.jsonl']) {
      const versions = readFileSync(join(__dirname, '../../../test/fixtures', file), 'utf8')
        .split('\n')
        .filter((line) => line.includes('claude_code_version'))
        .map((line) => JSON.parse(line).claude_code_version as string)
      for (const v of versions) expect(v >= TESTED_CLAUDE.min && v <= TESTED_CLAUDE.max, v).toBe(true)
    }
    expect(adapter.tested).toEqual(TESTED_CLAUDE)
    // A session restarted on the full prompt is not given the plugin that did not load.
    expect(adapter.launch({ ...ctx, view: 'chat', skills: false }).args).not.toContain('--plugin-dir')
    expect(adapter.launch({ ...ctx, view: 'chat', skills: true }).args).toContain('--plugin-dir')
  })

  // #6: a second look with a fresh context and only the tools that read.
  it('defines the read-only torno-reviewer subagent with --agents, whose tools read and change nothing', () => {
    for (const view of ['terminal', 'chat'] as const) {
      const agents = JSON.parse(after(claudeAdapter().launch({ ...ctx, view }).args, '--agents'))
      expect(Object.keys(agents)).toEqual(['torno-reviewer'])
      const reviewer = agents['torno-reviewer']
      expect(Object.keys(reviewer).sort()).toEqual(['description', 'maxTurns', 'model', 'prompt', 'tools'])
      expect(reviewer.model).toBe('sonnet')
      expect(reviewer.maxTurns).toBe(20)
      expect(reviewer.tools).toEqual(['mcp__torno__scene', 'mcp__torno__look', 'mcp__torno__marks', 'mcp__torno__measure', 'mcp__torno__check', 'mcp__torno__section', 'mcp__torno__describe', 'mcp__torno__diff', 'mcp__torno__scans', 'mcp__torno__scan_clash', 'mcp__torno__scan_deviation', 'mcp__torno__board', 'Read'])
      for (const never of ['Edit', 'Write', 'Bash', 'mcp__torno__resolve_mark', 'mcp__torno__show', 'mcp__torno__add_mark', 'mcp__torno__add_card']) expect(reviewer.tools).not.toContain(never)
      expect(reviewer.description).toMatch(/after a change of several steps/i)
      for (const said of ['what the user asked', 'every open mark', 'every dimension', 'mcp__torno__measure', 'never from the mesh', 'Change nothing', 'Read brief.md', 'at most twice', 'HOLDS, FAILS or UNCHECKED', 'UNCHECKED is never left out', 'mcp__torno__board', 'every size', 'every rule']) expect(reviewer.prompt).toContain(said)
    }
  })

  // #125: Sonnet unless the person says otherwise; `inherit` passes no model at all.
  it('runs the reviewer on Sonnet, on the model TORNO_REVIEWER_MODEL names, or on the session’s when it says inherit', () => {
    const tool = (t: string) => `mcp__torno__${t}`
    expect(reviewerAgents(tool, {})['torno-reviewer'].model).toBe('sonnet')
    expect(reviewerAgents(tool, { TORNO_REVIEWER_MODEL: 'haiku' })['torno-reviewer'].model).toBe('haiku')
    expect(reviewerAgents(tool, { TORNO_REVIEWER_MODEL: ' ' })['torno-reviewer'].model).toBe('sonnet')
    expect(reviewerAgents(tool, { TORNO_REVIEWER_MODEL: 'inherit' })['torno-reviewer']).not.toHaveProperty('model')
    expect(reviewerAgents(tool, { TORNO_REVIEWER_MODEL: 'inherit' })['torno-reviewer'].maxTurns).toBe(20)
  })

  it('is given the plugin that is in the app: a manifest and the five skills, each named in its frontmatter', () => {
    const dir = join(__dirname, '../../../resources/agent-plugin')
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).name).toBe('torno')
    for (const name of ['torno-model', 'build123d', 'scans', 'dimensions', 'printing']) {
      const text = readFileSync(join(dir, 'skills', name, 'SKILL.md'), 'utf8')
      const front = text.match(/^---\n([\s\S]*?)\n---\n/)![1]
      expect(front).toMatch(new RegExp(`^name: ${name}$`, 'm'))
      expect(front).toMatch(/^description: .{40,}$/m)
    }
  })
})
