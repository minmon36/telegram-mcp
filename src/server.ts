import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createTelegramMcpServer } from './mcp-server.js';

const DEFAULT_PORT = 8787;
const MCP_PATH = '/mcp';
const HOST = '127.0.0.1';
const port = readPort(process.env.MCP_PORT);

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('MCP_PORT must be an integer between 1 and 65535');
  }
  return value;
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', `http://${HOST}`).pathname;
  } catch {
    return '';
  }
}

function isAllowedHost(request: IncomingMessage, port: number): boolean {
  const host = request.headers.host?.toLowerCase();
  return host === `${HOST}:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function writeJsonError(response: ServerResponse, status: number, code: number, message: string): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    allow: 'POST'
  });
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null
    })
  );
}

async function handleMcpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isAllowedHost(request, port)) {
    writeJsonError(response, 403, -32000, 'Invalid Host header');
    return;
  }

  if (request.method !== 'POST') {
    writeJsonError(response, 405, -32000, 'Only POST is supported at this stateless MCP endpoint');
    return;
  }

  const server = createTelegramMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 1_048_576
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch {
    // Keep the HTTP error generic. Tool-level errors are returned in structured MCP results.
    writeJsonError(response, 500, -32603, 'Internal server error');
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

const httpServer = createServer(async (request, response) => {
  if (requestPath(request) !== MCP_PATH) {
    writeJsonError(response, 404, -32601, 'Not found');
    return;
  }
  await handleMcpRequest(request, response);
});

httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 10_000;

httpServer.on('error', () => {
  console.error('Telegram MCP server failed to start');
  process.exitCode = 1;
});

httpServer.listen(port, HOST, () => {
  console.log(`Telegram MCP server listening at http://${HOST}:${port}${MCP_PATH}`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
