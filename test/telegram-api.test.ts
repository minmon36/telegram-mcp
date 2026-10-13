import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramApiClient, TelegramApiError } from '../src/telegram-api.js';

const TEST_TOKEN = 'unit-test-token';

async function withTestToken<T>(token: string | undefined, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  if (token === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = token;
  }

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  }
}

test('reads the bot token from the supplied environment and sends no token in the body', async () => {
  let seenUrl = '';
  let seenBody = '';
  const client = new TelegramApiClient({
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenBody = String(init?.body);
      return new Response(JSON.stringify({ ok: true, result: { id: 42, is_bot: true, first_name: 'Test' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await withTestToken(TEST_TOKEN, async () => {
    const result = await client.getMe();
    assert.equal(result.id, 42);
    assert.match(seenUrl, new RegExp(`/bot${TEST_TOKEN}/getMe$`));
    assert.equal(seenBody, '{}');
  });
});

test('builds a Bot API media group with caption and parse mode on the first image', async () => {
  let payload: Record<string, unknown> | undefined;
  const client = new TelegramApiClient({
    fetchImpl: async (_input, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  await withTestToken(TEST_TOKEN, async () => {
    await client.sendMediaGroup(
      '@my_channel',
      ['https://cdn.example.test/one.png', 'https://cdn.example.test/two.png'],
      'Wallpaper set',
      'HTML'
    );
  });

  assert.deepEqual(payload, {
    chat_id: '@my_channel',
    media: [
      { type: 'photo', media: 'https://cdn.example.test/one.png', caption: 'Wallpaper set', parse_mode: 'HTML' },
      { type: 'photo', media: 'https://cdn.example.test/two.png' }
    ]
  });
});

test('returns a safe missing-token error without making a request', async () => {
  let called = false;
  const client = new TelegramApiClient({
    fetchImpl: async () => {
      called = true;
      return new Response('{}');
    }
  });

  await withTestToken(undefined, async () => {
    await assert.rejects(client.getMe(), (error: unknown) => {
      assert.ok(error instanceof TelegramApiError);
      assert.equal(error.code, 'missing_token');
      assert.equal(error.message, 'TELEGRAM_BOT_TOKEN is not set');
      return true;
    });
  });
  assert.equal(called, false);
});

test('redacts the token if a dependency includes the request URL in an error', async () => {
  const client = new TelegramApiClient({
    fetchImpl: async (input) => {
      throw new Error(`network failure for ${String(input)}`);
    }
  });

  await withTestToken(TEST_TOKEN, async () => {
    await assert.rejects(client.getMe(), (error: unknown) => {
      assert.ok(error instanceof TelegramApiError);
      assert.equal(error.code, 'network_error');
      assert.ok(!error.message.includes(TEST_TOKEN));
      assert.ok(error.message.includes('[redacted]'));
      return true;
    });
  });
});

test('uses a bounded timeout for Telegram requests', async () => {
  const client = new TelegramApiClient({
    timeoutMs: 5,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
  });

  await withTestToken(TEST_TOKEN, async () => {
    await assert.rejects(client.getMe(), (error: unknown) => {
      assert.ok(error instanceof TelegramApiError);
      assert.equal(error.code, 'timeout');
      assert.ok(!error.message.includes(TEST_TOKEN));
      return true;
    });
  });
});
