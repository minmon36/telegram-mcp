# Telegram Channel MCP

Private, minimal MCP server for a user's own Telegram channel. It uses the official Telegram **Bot API** with the official `@modelcontextprotocol/sdk`; it does not use personal-account sessions or Telegram user automation.

The server exposes only four tools:

- `telegram_get_bot_identity` — read the bot identity (`getMe`).
- `telegram_inspect_channel` — inspect one channel (`getChat`).
- `telegram_send_text` — send one text message (`sendMessage`).
- `telegram_send_media_group` — send 2–10 publicly reachable HTTP(S) image URLs as one album (`sendMediaGroup`), with an optional caption and parse mode.

## Requirements

- Node.js 18.18 or newer.
- A Telegram bot added as an administrator of the target channel, with permission to post.
- A bot token supplied in the `TELEGRAM_BOT_TOKEN` process environment.

The package does not load `.env` files and does not contain a token. Keep the real token in the shell or service environment that starts the process.

## Install and run

From this directory:

```bash
npm install
npm run build
```

Set the token in the process environment without putting it in a file or command-line argument:

```bash
# macOS/Linux
export TELEGRAM_BOT_TOKEN='your-token-from-botfather'
npm start
```

```powershell
# Windows PowerShell
$env:TELEGRAM_BOT_TOKEN = 'your-token-from-botfather'
npm start
```

The optional `MCP_PORT` environment variable defaults to `8787`. The server always binds to loopback (`127.0.0.1`) and serves the stateless Streamable HTTP endpoint:

```text
http://127.0.0.1:8787/mcp
```

## OmniRush.ai workspace MCP connection

1. Start the server in the same environment where the token is set.
2. In OmniRush.ai, open **Settings > Library > Advanced settings > Add workspace MCP**.
3. Add the HTTP endpoint `http://127.0.0.1:8787/mcp` and indicate that this local server does **not** require OAuth.

The endpoint is loopback-only, so it is reachable by OmniRush.ai on the same machine. A hosted or remote MCP client cannot reach this private endpoint without a separately managed network boundary.

## Tool inputs

Channel inputs accept a public `@username` or a numeric chat ID such as `-1001234567890`.

`telegram_send_text`:

```json
{
  "channel": "@my_channel",
  "text": "Hello from the bot",
  "parseMode": "MarkdownV2"
}
```

`telegram_send_media_group` accepts 2–10 HTTP(S) URLs, matching Telegram's `sendMediaGroup` requirement. Local/private hosts, URL credentials, non-HTTP(S) schemes, and invalid group sizes are rejected before contacting Telegram:

```json
{
  "channel": "@my_channel",
  "imageUrls": [
    "https://cdn.example.com/wallpaper-1.jpg",
    "https://cdn.example.com/wallpaper-2.jpg"
  ],
  "caption": "A new wallpaper set",
  "parseMode": "HTML"
}
```

Captions are applied to the first album item, as required by the Bot API. Telegram itself validates the final media type and URL reachability.

Every tool returns structured JSON with an `ok` flag. Telegram failures include a safe error code/message and relevant Telegram/HTTP status information. The bot token is never returned or logged; network and dependency errors are redacted before they become tool results.

## Checks

```bash
npm test
npm run typecheck
```

The tests cover channel/media/text validation, environment-only token loading, missing-token handling, redaction, and request timeouts. No real Telegram request is made by the tests.

## Integration limitation

This package intentionally implements stateless MCP Streamable HTTP with JSON responses and supports POST requests at `/mcp`. It does not implement the deprecated HTTP+SSE transport, OAuth, cloud hosting, or a personal Telegram session. The workspace MCP client must support the standard Streamable HTTP endpoint and run on the same machine as this loopback server.
