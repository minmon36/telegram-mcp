import { z } from 'zod/v4';

const PUBLIC_USERNAME_PATTERN = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/u;
const NUMERIC_CHAT_ID_PATTERN = /^-?\d{1,20}$/u;

/** Telegram accepts public usernames and numeric chat IDs for these operations. */
export const ChannelSchema = z
  .string()
  .trim()
  .min(1, 'channel is required')
  .max(255, 'channel is too long')
  .refine(
    (value) => PUBLIC_USERNAME_PATTERN.test(value) || NUMERIC_CHAT_ID_PATTERN.test(value),
    'channel must be a public @username or numeric chat ID'
  );

export const ParseModeSchema = z.enum(['HTML', 'Markdown', 'MarkdownV2']);

export const TextSchema = z
  .string()
  .min(1, 'text is required')
  .refine((value) => value.trim().length > 0, 'text must contain non-whitespace characters')
  .max(4096, 'text must be at most 4096 characters');

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
  ) {
    return true;
  }

  if (normalized.includes(':')) {
    if (normalized.startsWith('::ffff:')) {
      return isPrivateOrLocalHost(normalized.slice('::ffff:'.length));
    }
    return (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89a-f]/u.test(normalized)
    );
  }

  const octets = normalized.split('.').map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password &&
      !isPrivateOrLocalHost(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Telegram downloads each URL, so only public HTTP(S) URLs are accepted. */
export const ImageUrlSchema = z
  .string()
  .trim()
  .url('imageUrls entries must be valid URLs')
  .refine(isPublicImageUrl, 'image URL must be a public HTTP(S) URL without credentials');

export const GetChannelInputSchema = z.object({ channel: ChannelSchema }).strict();

export const SendTextInputSchema = z
  .object({
    channel: ChannelSchema,
    text: TextSchema,
    parseMode: ParseModeSchema.optional()
  })
  .strict();

export const SendMediaGroupInputSchema = z
  .object({
    channel: ChannelSchema,
    imageUrls: z.array(ImageUrlSchema).min(2, 'imageUrls must contain at least two URLs').max(10, 'imageUrls may contain at most 10 URLs'),
    caption: z.string().max(1024, 'caption must be at most 1024 characters').optional(),
    parseMode: ParseModeSchema.optional()
  })
  .strict();

export type GetChannelInput = z.infer<typeof GetChannelInputSchema>;
export type SendTextInput = z.infer<typeof SendTextInputSchema>;
export type SendMediaGroupInput = z.infer<typeof SendMediaGroupInputSchema>;
