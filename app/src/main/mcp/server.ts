import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { BodyTooLarge, type HttpRouter, readBody } from '../http'
import { registerPrompts } from './prompts'
import { SERVER_INSTRUCTIONS } from './schemas'
import { registerTools, type ToolDeps } from './tools'

const BODY_LIMIT = 4 * 1024 * 1024
const VERSION = '0.2.2'

/**
 * Serves `POST /mcp/<objectId>` (the router lets a request through only with a token of that object in its
 * `X-Torno-Session` header, its session's, and answers 404 otherwise): the MCP server an agent working on that object
 * is given, as Streamable HTTP without sessions. Each request gets a server and
 * a transport of its own, closed when its response is, so nothing is kept
 * between requests and any number of agents can ask at once.
 */
export function mountMcp(http: HttpRouter, deps: ToolDeps): void {
  http.route('/mcp', async (req, res, rest) => {
    const rpcError = (status: number, message: string, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
    }
    if (rest.length !== 1) return rpcError(404, 'Not found: the address torno gave ends in the id of a project')
    // Without sessions there is no stream to open with GET and nothing to end with DELETE.
    if (req.method !== 'POST') return rpcError(405, 'Method not allowed: POST only', { allow: 'POST' })

    let body: unknown
    try {
      body = JSON.parse(await readBody(req, BODY_LIMIT))
    } catch (e) {
      if (e instanceof BodyTooLarge) return rpcError(413, e.message)
      return rpcError(400, 'Parse error: the body is not JSON')
    }

    const server = new McpServer({ name: 'torno', version: VERSION }, { instructions: SERVER_INSTRUCTIONS })
    // An id the workspace does not have is answered by the tools, in words the agent reads.
    registerTools(server, deps, rest[0])
    registerPrompts(server)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  })
}
