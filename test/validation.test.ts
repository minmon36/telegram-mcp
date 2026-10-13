import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChannelSchema,
  SendMediaGroupInputSchema,
  SendTextInputSchema
} from '../src/validation.js';

test('accepts public usernames and numeric channel IDs', () => {
  assert.equal(ChannelSchema.parse('@my_channel'), '@my_channel');
  assert.equal(ChannelSchema.parse('-1001234567890'), '-1001234567890');
});

test('rejects ambiguous or local channel identifiers', () => {
  assert.throws(() => ChannelSchema.parse('my channel'));
  assert.throws(() => ChannelSchema.parse('https://t.me/my_channel'));
});

test('validates two to ten public image URLs', () => {
  const two = SendMediaGroupInputSchema.parse({
    channel: '@my_channel',
    imageUrls: ['https://cdn.example.test/one.png', 'https://cdn.example.test/two.png']
  });
  assert.equal(two.imageUrls.length, 2);

  assert.throws(() =>
    SendMediaGroupInputSchema.parse({ channel: '@my_channel', imageUrls: ['https://cdn.example.test/only.png'] })
  );
  assert.throws(() =>
    SendMediaGroupInputSchema.parse({
      channel: '@my_channel',
      imageUrls: Array.from({ length: 11 }, (_, index) => `https://cdn.example.test/${index}.png`)
    })
  );
  assert.throws(() =>
    SendMediaGroupInputSchema.parse({ channel: '@my_channel', imageUrls: ['file:///tmp/wallpaper.png'] })
  );
  assert.throws(() =>
    SendMediaGroupInputSchema.parse({ channel: '@my_channel', imageUrls: ['http://127.0.0.1/image.png'] })
  );
});

test('enforces Telegram text and caption limits and parse modes', () => {
  assert.equal(
    SendTextInputSchema.parse({
      channel: '@my_channel',
      text: 'A message',
      parseMode: 'MarkdownV2'
    }).parseMode,
    'MarkdownV2'
  );
  assert.throws(() => SendTextInputSchema.parse({ channel: '@my_channel', text: '' }));
  assert.throws(() => SendTextInputSchema.parse({ channel: '@my_channel', text: '   ' }));
  assert.throws(() => SendTextInputSchema.parse({ channel: '@my_channel', text: 'x'.repeat(4097) }));
  assert.throws(() =>
    SendMediaGroupInputSchema.parse({
      channel: '@my_channel',
      imageUrls: ['https://cdn.example.test/wallpaper.png'],
      caption: 'x'.repeat(1025)
    })
  );
});
