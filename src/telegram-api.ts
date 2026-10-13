export const DEFAULT_TELEGRAM_API_TIMEOUT_MS = 15_000;

export interface TelegramApiClientOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: unknown;
  description?: unknown;
  parameters?: unknown;
}

export interface TelegramApiErrorOptions {
  telegramErrorCode?: number;
  retryAfterSeconds?: number;
  httpStatus?: number;
}

/** Errors intentionally contain only safe, redacted information. */
export class TelegramApiError extends Error {
  readonly code: string;
  readonly telegramErrorCode?: number;
  readonly retryAfterSeconds?: number;
  readonly httpStatus?: number;

  constructor(code: string, message: string, options: TelegramApiErrorOptions = {}) {
    super(message);
    this.name = 'TelegramApiError';
    this.code = code;
    this.telegramErrorCode = options.telegramErrorCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.httpStatus = options.httpStatus;
  }
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  description?: string;
  invite_link?: string;
  [key: string]: unknown;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function redact(value: string, secret: string): string {
  return value
    .replaceAll(secret, '[redacted]')
    .replaceAll(encodeURIComponent(secret), '[redacted]')
    .slice(0, 512);
}

function readToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new TelegramApiError('missing_token', 'TELEGRAM_BOT_TOKEN is not set');
  }
  if (/[\s\u0000-\u001f\u007f/?#]/u.test(token) || token.length > 256) {
    throw new TelegramApiError('invalid_token', 'TELEGRAM_BOT_TOKEN has an invalid format');
  }
  return token;
}

function numericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function retryAfterValue(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const retryAfter = value.retry_after;
  return typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
}

export class TelegramApiClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TelegramApiClientOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TELEGRAM_API_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new RangeError('timeoutMs must be an integer between 1 and 120000');
    }

    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>('getMe', {});
  }

  async getChat(channel: string): Promise<TelegramChat> {
    return this.request<TelegramChat>('getChat', { chat_id: channel });
  }

  async sendMessage(channel: string, text: string, parseMode?: string): Promise<TelegramMessage> {
    return this.request<TelegramMessage>('sendMessage', {
      chat_id: channel,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {})
    });
  }

  async sendMediaGroup(
    channel: string,
    imageUrls: string[],
    caption?: string,
    parseMode?: string
  ): Promise<TelegramMessage[]> {
    const media = imageUrls.map((mediaUrl, index) => ({
      type: 'photo',
      media: mediaUrl,
      ...(index === 0 && caption !== undefined ? { caption } : {}),
      ...(index === 0 && parseMode ? { parse_mode: parseMode } : {})
    }));

    return this.request<TelegramMessage[]>('sendMediaGroup', {
      chat_id: channel,
      media
    });
  }

  private async request<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const token = readToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const endpoint = `https://api.telegram.org/bot${token}/${method}`;

    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new TelegramApiError('invalid_response', `Telegram API returned non-JSON data (HTTP ${response.status})`, {
          httpStatus: response.status
        });
      }

      if (!isRecord(body)) {
        throw new TelegramApiError('invalid_response', 'Telegram API returned an invalid response');
      }

      const envelope = body as TelegramEnvelope<T>;
      if (!response.ok || envelope.ok !== true) {
        const description =
          typeof envelope.description === 'string' ? redact(envelope.description, token) : 'Telegram API request failed';
        const telegramErrorCode = numericValue(envelope.error_code);
        const retryAfterSeconds = retryAfterValue(envelope.parameters);
        throw new TelegramApiError('telegram_error', description, {
          telegramErrorCode,
          retryAfterSeconds,
          httpStatus: response.status
        });
      }

      if (!('result' in envelope)) {
        throw new TelegramApiError('invalid_response', 'Telegram API response did not contain a result', {
          httpStatus: response.status
        });
      }

      return envelope.result as T;
    } catch (error) {
      if (error instanceof TelegramApiError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new TelegramApiError('timeout', 'Telegram API request timed out');
      }
      const message = error instanceof Error ? redact(error.message, token) : 'unknown network error';
      throw new TelegramApiError('network_error', `Telegram API request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
