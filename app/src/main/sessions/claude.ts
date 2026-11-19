import { join } from 'node:path'
import { SESSION_HEADER } from '../http'
import type { AgentAdapter } from './adapter'
import { ClaudeStream } from './stream'
import { HOOK_EVENTS } from './status'

export { HOOK_EVENTS }

const HOOK_TIMEOUT_S = 5
/**
 * The variable of the agent's environment that holds the session's token. Claude Code reads names that look like a
 * credential (`*_API_KEY`, `NPM_TOKEN`, ...) as empty toward a remote server: this one does not look like one.
 */
const TOKEN_VARIABLE = 'TORNO_SESSION'
/**
 * The `PostToolUse` of an edit of the model is answered once the build the save started has ended (`Sessions.afterEdit`,
 * which answers by 55 s that a build is running): builds of seconds are usual. Every other tool's is answered at once,
 * so the one hook of the event has this longer limit (a second entry matched to the edit tools would post them twice).
 */
const EDIT_HOOK_TIMEOUT_S = 60
/**
 * The `Stop` waits for a build begun in the turn, and for its dimensions to be measured, up to 20 s
 * (`STOP_WAIT_MS` in `manager.ts`) before it judges: the limit leaves room for that and for the answer.
 */
const STOP_HOOK_TIMEOUT_S = 25
/**
 * What makes Claude Code speak JSON lines on its pipes instead of drawing a terminal: a prompt is a line of
 * stdin, everything it does a line of stdout, and what it would ask the person (a permission, a question) a
 * request on stdout that is answered on stdin.
 */
const HEADLESS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio']

/** The tools of torno's the reviewer may call: those that read the part. Not `show`, `resolve_mark`, `add_mark`. */
const REVIEWER_TOOLS = ['scene', 'look', 'marks', 'measure', 'check', 'section', 'describe', 'diff', 'scans', 'scan_clash', 'scan_deviation', 'board']

/** The turns a review may take (`maxTurns` of the subagent): a project with many marks has no other bound. */
const REVIEWER_MAX_TURNS = 20

/**
 * The model of the reviewer: Sonnet, a judge cheaper than the session's, unless `TORNO_REVIEWER_MODEL` names another
 * (`opus`, `haiku`, a full model name) or says `inherit`, the session's own (nothing is passed then).
 */
export function reviewerModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const named = env.TORNO_REVIEWER_MODEL?.trim()
  if (named === 'inherit') return undefined
  return named || 'sonnet'
}

/**
 * `torno-reviewer`, a subagent passed with `--agents` (nothing is written to `.claude/agents/`): a second look at a
 * change with a fresh context and only the tools that read, so it can change nothing.
 */
export function reviewerAgents(toolName: (tool: string) => string, env: NodeJS.ProcessEnv = process.env) {
  const model = reviewerModel(env)
  return {
    'torno-reviewer': {
      description: 'Reviews the current build of the torno project against what the user asked, read-only. Use it after a change of several steps, before saying it is done.',
      prompt: [
        'You review a CAD part in torno and change nothing.',
        'Read brief.md in the project folder first, if there is one: it is the user’s own words. Then take the request you were given, what the user asked for.',
        `Then read the board with ${toolName('board')}: the sizes and rules there are the person's brief, and they change as the person edits them, so read it now and not from memory. Hold the build to every size (measure it) and every rule (a rule that numbers cannot settle is UNCHECKED, said so).`,
        `Check the current build against all of it. Start with numbers: ${toolName('scene')} for the build status (a failed build is the first finding) and the scans, ${toolName('diff')} for what the last edit changed, every open mark with ${toolName('marks')} (was each acted on as its note asks?), and every dimension (does it pass on the latest build?). Where a scan is aligned, ${toolName('scan_clash')} and ${toolName('scan_deviation')} say how the part meets it; a scan is never exact.`,
        `Every number you state comes from ${toolName('measure')}, ${toolName('check')} or ${toolName('section')}, never from the mesh, a picture or the model’s source; say so when a value is approximate.`,
        `Then ${toolName('look')} at most twice, at the views that show the change, for what numbers cannot settle.`,
        'End with a list, one line each, that begins with HOLDS, FAILS or UNCHECKED, then the item (a mark, a dimension, a sentence of the brief), the number and the ref. UNCHECKED is never left out: say what you could not check, and why. No other summary, and never "mostly fine".',
        'Change nothing: do not edit files, do not resolve or add marks, do not change what the user sees.'
      ].join(' '),
      tools: [...REVIEWER_TOOLS.map(toolName), 'Read'],
      ...(model ? { model } : {}),
      maxTurns: REVIEWER_MAX_TURNS
    }
  }
}

/**
 * The plugin of skills torno passes (`resources/agent-plugin`): its name and its skills, which the CLI's `init` is read
 * for (`transcript.ts`): the chat says when they are not there. `claude.test.ts` holds them to the folder.
 */
export const TORNO_PLUGIN = { name: 'torno', skills: ['torno-model', 'build123d', 'scans', 'dimensions', 'printing'] } as const

/**
 * The versions of Claude Code torno was checked against, inclusive: those of the recordings in `test/fixtures/`
 * (`claude_code_version` of their `init`). One older than its minimum, or of a newer major or minor than its maximum, is said once in a chat (a patch of
 * the tested minor is quiet), and nothing more is done
 * about it. The range moves when a new stream is recorded (`test/fixtures/RECORDING.md`) and the manual's line with it.
 */
export const TESTED_CLAUDE = { min: '2.1.300', max: '2.1.301' } as const

/**
 * Claude Code. Everything torno adds is passed on the command line, in the
 * environment or in a file of torno's own, so the person's own settings and
 * MCP servers are neither read nor changed (no --strict-mcp-config: their
 * servers keep working beside torno's).
 *
 * The session's token is in the environment alone (`TORNO_SESSION`), never in
 * an argument: Claude Code puts it in the `X-Torno-Session` header itself. Each
 * hook names it in `allowedEnvVars` (an http hook expands only those), and the
 * MCP server is given in a file (`--mcp-config <path>`, as a `.mcp.json` is,
 * whose `headers` expand `${VAR}`) that holds the placeholder, not the token.
 *
 * `agentCmd` replaces the command `claude`: TORNO_AGENT_CMD, split on spaces,
 * so a path with a space in it cannot be named this way.
 *
 * `pluginDir` is torno's plugin of skills (`resources/agent-plugin`, `agentPluginDir()`), loaded with
 * `--plugin-dir` for that session only: nothing is installed in the person's Claude Code.
 */
const toolName = (tool: string): string => `mcp__torno__${tool}`

export function claudeAdapter(agentCmd?: string, pluginDir?: string, opts: { reviewer?: boolean } = {}): AgentAdapter {
  const [command = 'claude', ...before] = (agentCmd ?? '').split(' ').filter(Boolean)
  return {
    command: 'claude',
    probe: { command, args: before },
    skills: Boolean(pluginDir),
    ...(pluginDir ? { plugin: TORNO_PLUGIN } : {}),
    tested: TESTED_CLAUDE,
    toolName,
    launch(ctx) {
      const hook = (event: string) => [
        {
          hooks: [
            {
              type: 'http',
              url: ctx.hookUrl(event),
              timeout: event === 'PostToolUse' ? EDIT_HOOK_TIMEOUT_S : event === 'Stop' ? STOP_HOOK_TIMEOUT_S : HOOK_TIMEOUT_S,
              headers: { [SESSION_HEADER]: `$${TOKEN_VARIABLE}` },
              allowedEnvVars: [TOKEN_VARIABLE]
            }
          ]
        }
      ]
      const settings = { hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, hook(event)])) }
      const mcp = { mcpServers: { torno: { type: 'http', url: ctx.mcpUrl, headers: { [SESSION_HEADER]: `\${${TOKEN_VARIABLE}}` } } } }
      const mcpFile = join(ctx.configDir, `${ctx.sessionId}.mcp.json`)
      const args = [
        ...before,
        ...(ctx.view === 'chat' ? HEADLESS : []),
        ctx.resume ? '--resume' : '--session-id',
        ctx.conversationId,
        '--mcp-config',
        mcpFile,
        '--allowedTools',
        'mcp__torno__*',
        '--settings',
        JSON.stringify(settings)
      ]
      // `reviewer: false` only in an eval run that takes it away (`main/ablations.ts`).
      if (opts.reviewer !== false) args.push('--agents', JSON.stringify(reviewerAgents(toolName)))
      if (pluginDir && ctx.skills !== false) args.push('--plugin-dir', pluginDir)
      if (ctx.systemPrompt) args.push('--append-system-prompt', ctx.systemPrompt)
      // `--flag=value`: one argument, so that what follows can never be read as a flag of its own.
      if (ctx.model) args.push(`--model=${ctx.model}`)
      if (ctx.effort) args.push(`--effort=${ctx.effort}`)
      return { command, args, env: { [TOKEN_VARIABLE]: ctx.token }, files: [{ path: mcpFile, text: `${JSON.stringify(mcp, null, 2)}\n` }] }
    },
    // Its headless mode on pipes (`HEADLESS` above).
    chat: (run) => new ClaudeStream(run)
  }
}
