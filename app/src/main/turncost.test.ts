import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { MOST_NOTE_PICTURES, NOTE_PICTURE_EDGE } from './notes/pictures'
import { DEFAULT_SIZE, MAX_SIZE, SERVER_INSTRUCTIONS } from './mcp/schemas'
import { registerTools, type ToolDeps } from './mcp/tools'
import { FULL_PROMPT, SYSTEM_PROMPT } from './prompt'

// What a turn costs (#127), held so that it only grows on purpose. Measured from the code, never with the real agent.
// Claude 4.7 and later read an image in 28 px patches, one visual token each, up to 4,784 of them and 2,576 px on the long
// edge (platform docs, "Vision"): so a picture costs the same however empty it is, and nothing is downscaled below 2000 px.

/** The visual tokens of a picture of this size. */
const pictureTokens = (width: number, height: number): number => Math.ceil(width / 28) * Math.ceil(height / 28)

async function listed() {
  const server = new McpServer({ name: 'torno', version: '0' }, { instructions: SERVER_INSTRUCTIONS })
  registerTools(server, {} as ToolDeps, 'x')
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return (await client.listTools()).tools
}

describe('what a turn costs', () => {
  it('a picture costs by its area: the default look about 1,600 tokens at 4:3, the largest 3,900', () => {
    expect(pictureTokens(DEFAULT_SIZE, (DEFAULT_SIZE * 3) / 4)).toBe(1610)
    expect(pictureTokens(MAX_SIZE, (MAX_SIZE * 3) / 4)).toBe(3888)
    expect(pictureTokens(1280, 720)).toBe(1196)
  })

  it('the pictures torno sends of the person\'s own are no larger than a look, and an answer carries six at most', () => {
    expect(NOTE_PICTURE_EDGE).toBeLessThanOrEqual(DEFAULT_SIZE)
    // Six pictures at 1280 px, 4:3: under 10,000 tokens in one answer.
    expect(MOST_NOTE_PICTURES * pictureTokens(NOTE_PICTURE_EDGE, (NOTE_PICTURE_EDGE * 3) / 4)).toBeLessThan(10_000)
  })

  it('the tools loaded up front are the nine the prompt relies on, in at most 33,000 characters of name, description and schema', async () => {
    const tools = await listed()
    const loaded = tools.filter((t) => (t._meta as Record<string, unknown> | undefined)?.['anthropic/alwaysLoad'] === true)
    expect(loaded.map((t) => t.name).sort()).toEqual(['check', 'describe', 'features', 'look', 'marks', 'measure', 'resolve_mark', 'scene', 'show'])
    const chars = loaded.reduce((sum, t) => sum + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length, 0)
    expect(chars).toBeLessThan(33_000)
    // The tools left to tool search cost nothing until one is searched for (51,000 characters more): their names are in the instructions.
    expect(tools).toHaveLength(30)
  })

  it('the text torno adds to the system prompt, with the instructions of its server, is under 12,000 characters', () => {
    expect(SYSTEM_PROMPT.length + SERVER_INSTRUCTIONS.length).toBeLessThan(12_000)
    expect(FULL_PROMPT.length).toBeLessThan(8900)
  })
})
