import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import {
  GetChannelInputSchema,
  SendMediaGroupInputSchema,
  SendTextInputSchema,
  type GetChannelInput,
  type SendMediaGroupInput,
  type SendTextInput
} from './validation.js';
import { TelegramApiClient, TelegramApiError } from './telegram-api.js';

type StructuredResult = Record<string, unknown>;

function jsonText(value: StructuredResult): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{"ok":false,"error":{"code":"serialization_error","message":"Result could not be serialized"}}';
  }
}

function toolResult(value: StructuredResult, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: jsonText(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

function success(operation: string, result: unknown): CallToolResult {
  return toolResult({ ok: true, operation, result });
}

function failure(operation: string, error: unknown): CallToolResult {
  if (error instanceof TelegramApiError) {
    return toolResult(
      {
        ok: false,
        operation,
        error: {
          code: error.code,
          message: error.message,
          ...(error.telegramErrorCode !== undefined ? { telegramErrorCode: error.telegramErrorCode } : {}),
          ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
          ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {})
        }
      },
      true
    );
  }

  if (error instanceof z.ZodError) {
    return toolResult(
      {
        ok: false,
        operation,
        error: {
          code: 'invalid_input',
          message: 'Input validation failed',
          issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
        }
      },
      true
    );
  }

  // Do not reflect unknown exception messages: they could contain credentials from a dependency.
  return toolResult(
    {
      ok: false,
      operation,
      error: {
        code: 'internal_error',
        message: 'Telegram operation failed'
      }
    },
    true
  );
}

export function createTelegramMcpServer(client = new TelegramApiClient()): McpServer {
  const server = new McpServer(
    {
      name: 'telegram-channel-mcp',
      version: '0.1.0'
    },
    {
      maxToolInputElements: 128
    }
  );

  server.registerTool(
    'telegram_get_bot_identity',
    {
      title: 'Telegram: get bot identity',
      description: 'Read the Telegram bot identity using getMe. This tool does not expose the bot token.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async () => {
      try {
        return success('get_bot_identity', await client.getMe());
      } catch (error) {
        return failure('get_bot_identity', error);
      }
    }
  );

  server.registerTool(
    'telegram_inspect_channel',
    {
      title: 'Telegram: inspect channel',
      description: 'Read basic metadata for one Telegram channel using getChat. Use a public @username or numeric chat ID.',
      inputSchema: GetChannelInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
    },
    async ({ channel }: GetChannelInput) => {
      try {
        const input = GetChannelInputSchema.parse({ channel });
        return success('inspect_channel', await client.getChat(input.channel));
      } catch (error) {
        return failure('inspect_channel', error);
      }
    }
  );

  server.registerTool(
    'telegram_send_text',
    {
      title: 'Telegram: send text',
      description: 'Send exactly one text message to the selected Telegram channel. HTML, Markdown, or MarkdownV2 parsing is optional.',
      inputSchema: SendTextInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ channel, text, parseMode }: SendTextInput) => {
      try {
        const input = SendTextInputSchema.parse({ channel, text, parseMode });
        return success('send_text', await client.sendMessage(input.channel, input.text, input.parseMode));
      } catch (error) {
        return failure('send_text', error);
      }
    }
  );

  server.registerTool(
    'telegram_send_media_group',
    {
      title: 'Telegram: send image group',
      description: 'Send one media group containing 1-10 publicly reachable HTTP(S) image URLs. An optional caption is applied to the first image.',
      inputSchema: SendMediaGroupInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    async ({ channel, imageUrls, caption, parseMode }: SendMediaGroupInput) => {
      try {
        const input = SendMediaGroupInputSchema.parse({ channel, imageUrls, caption, parseMode });
        return success(
          'send_media_group',
          await client.sendMediaGroup(input.channel, input.imageUrls, input.caption, input.parseMode)
        );
      } catch (error) {
        return failure('send_media_group', error);
      }
    }
  );

  return server;
}
