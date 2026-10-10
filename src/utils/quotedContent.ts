import type { QuotedContent } from '@components/design-system';
import { msToClockString } from '@media/mediaUploadService';
import { MSG_TYPE, type ChatMessage } from '@app-types/chat';

const FALLBACK_SNIPPET = 'Original message';

/**
 * Maps a ChatMessage to the design system's QuotedContent union, for
 * rendering it as a reply-quote (in-bubble QuoteBlock, or ChatInputBar's
 * reply bar). `resolvedMediaUri` is this device's locally-usable URI for the
 * parent's thumbnail/image — resolved via useResolvedMediaUri by the caller,
 * since this is a plain mapper and can't call hooks itself; falls back to
 * the raw (possibly not-yet-downloaded) MEDIA_CLOUD value when absent.
 *
 * `message === null` covers a REPLY_PARENT that failed to resolve (deleted
 * parent, or a reply received before its parent arrived) — same fallback as
 * MSG_TYPE.SYSTEM, which is never itself a reachable reply target (never
 * rendered as a MessageBubble, so it can never be swiped/long-pressed into
 * one) but is guarded here defensively all the same.
 */
export function toQuotedContent(
  message: ChatMessage | null,
  resolvedMediaUri?: string | null,
): QuotedContent {
  if (!message) return { kind: 'text', snippet: FALLBACK_SNIPPET };

  switch (message.MSG_TYPE) {
    case MSG_TYPE.STICKER:
      return { kind: 'sticker', source: { uri: resolvedMediaUri ?? message.MEDIA_CLOUD ?? '' } };
    case MSG_TYPE.GIF:
      return { kind: 'gif', thumbnail: { uri: resolvedMediaUri ?? message.MEDIA_CLOUD ?? '' } };
    case MSG_TYPE.IMAGE:
      return {
        kind: 'image',
        thumbnail: { uri: resolvedMediaUri ?? message.MEDIA_CLOUD ?? '' },
      };
    case MSG_TYPE.VIDEO:
      return {
        kind: 'video',
        thumbnail: { uri: resolvedMediaUri ?? message.MEDIA_CLOUD_THUMBNAIL ?? '' },
        duration:
          message.MEDIA_DURATION_MS != null ? msToClockString(message.MEDIA_DURATION_MS) : undefined,
      };
    case MSG_TYPE.VOICE:
      return { kind: 'voice', duration: msToClockString(message.MEDIA_DURATION_MS ?? 0) };
    case MSG_TYPE.TEXT:
      return { kind: 'text', snippet: message.MSG_TEXT || FALLBACK_SNIPPET };
    default:
      return { kind: 'text', snippet: FALLBACK_SNIPPET };
  }
}
