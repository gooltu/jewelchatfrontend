import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import type { ImagePickerAsset } from 'expo-image-picker';
import { getUploadUrl } from '@gameserver/getUploadUrlApi';
import { getDownloadUrl } from '@gameserver/getDownloadUrlApi';
import { putFileToSignedUrl } from './s3Upload';

/**
 * Talks to external media infrastructure (S3 via the gameserver's presigned
 * URLs) — distinct from services/, which orchestrates this app's own
 * DB/XMPP state. chatService.ts calls into this module the same way it
 * already calls into chatserver/* and gameserver/*Api.ts.
 */

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 1600;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_DURATION_MS = 60_000;
export const AUDIO_MAX_DURATION_MS = 180_000;

/** Subset of expo-image-picker's result this module cares about. */
export type PickedMedia = ImagePickerAsset;

export interface CapCheckResult {
  ok: boolean;
  /** User-facing reason, only set when ok is false. */
  reason?: string;
}

export interface PreparedUpload {
  /** file:// URI in documentDirectory — durable across app kill, see module doc below. */
  localUri: string;
  /** Video poster frame, also in documentDirectory. Always null for images. */
  thumbnailLocalUri: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
  mimeType: string;
}

export interface UploadResult {
  mediaCloud: string;
  mediaThumbnail: string | null;
}

/**
 * Pure client-side rejection, before any DB row or network call — checked
 * against the picker's *original* asset, before any downscaling. Images
 * over the byte cap are rejected outright rather than downscaled away (only
 * over-dimension images get downscaled, in prepareImageForUpload); videos
 * have no transcoding in v1, so both byte and duration caps are hard
 * rejections.
 */
export function checkMediaCaps(media: PickedMedia): CapCheckResult {
  if (media.type === 'video') {
    if ((media.duration ?? 0) > VIDEO_MAX_DURATION_MS) {
      return { ok: false, reason: `Videos longer than ${Math.round(VIDEO_MAX_DURATION_MS / 1000)}s aren't supported yet.` };
    }
    if ((media.fileSize ?? 0) > VIDEO_MAX_BYTES) {
      return { ok: false, reason: `Videos larger than ${Math.round(VIDEO_MAX_BYTES / (1024 * 1024))}MB aren't supported yet.` };
    }
    return { ok: true };
  }
  if ((media.fileSize ?? 0) > IMAGE_MAX_BYTES) {
    return { ok: false, reason: `Images larger than ${Math.round(IMAGE_MAX_BYTES / (1024 * 1024))}MB aren't supported yet.` };
  }
  return { ok: true };
}

/**
 * Checked at commit time (ChatInputBar's onSendVoiceNote), not before
 * recording starts — unlike checkMediaCaps, there's no imperative hook to
 * reject or auto-stop an overlong recording while the mock recorder UI is
 * already running.
 */
export function checkVoiceCaps(durationMs: number): CapCheckResult {
  if (durationMs > AUDIO_MAX_DURATION_MS) {
    return {
      ok: false,
      reason: `Voice notes longer than ${Math.round(AUDIO_MAX_DURATION_MS / 60_000)} min aren't supported yet.`,
    };
  }
  return { ok: true };
}

/**
 * Durable "pending upload" location — documentDirectory, not cacheDirectory,
 * so a prepared file survives an app kill mid-upload (resumePendingMediaUploads
 * in chatService.ts reads it back by the ChatMessage row's MEDIA_CLOUD
 * file:// placeholder). Cache-dir files (expo-image-manipulator's own
 * saveAsync default) can be OS-evicted without an app kill, which is why
 * every prepared file is moved here immediately after it's produced.
 */
function pendingUploadsDir(): Directory {
  const dir = new Directory(Paths.document, 'pendingUploads');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Normalizes a picker/manipulator-supplied URI before it's ever handed to
 * `new File(...)`. Observed on Android: a bare absolute filesystem path
 * with no `file://` scheme at all (not just `content://` vs `file://`) —
 * expo-file-system's underlying `java.io.File(URI)` throws
 * "URI is not absolute" (IllegalArgumentException) for that shape rather
 * than treating it as a normal file path. `content://` is left untouched —
 * it already has a scheme and expo-file-system reads/moves it natively.
 */
function toFileUri(uri: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(uri)) return uri;
  if (__DEV__) console.log('[mediaUploadService] scheme-less URI, normalizing to file://', uri);
  return `file://${uri.startsWith('/') ? uri : `/${uri}`}`;
}

async function persistToPendingUploads(sourceUri: string, extension: string): Promise<string> {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const dest = new File(pendingUploadsDir(), name);
  const source = new File(toFileUri(sourceUri));
  await source.move(dest);
  return dest.uri;
}

function extensionFromUri(uri: string, fallback: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  return match?.[1]?.toLowerCase() ?? fallback;
}

/**
 * Downscales to IMAGE_MAX_DIMENSION's long edge when needed (no-op if
 * already small) and persists the result to documentDirectory.
 */
export async function prepareImageForUpload(media: PickedMedia): Promise<PreparedUpload> {
  const longEdge = Math.max(media.width, media.height);
  const context = ImageManipulator.manipulate(media.uri);
  if (longEdge > IMAGE_MAX_DIMENSION) {
    if (media.width >= media.height) {
      context.resize({ width: IMAGE_MAX_DIMENSION });
    } else {
      context.resize({ height: IMAGE_MAX_DIMENSION });
    }
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const localUri = await persistToPendingUploads(saved.uri, 'jpg');
  const file = new File(localUri);

  return {
    localUri,
    thumbnailLocalUri: null,
    width: saved.width,
    height: saved.height,
    durationMs: null,
    sizeBytes: file.size,
    mimeType: 'image/jpeg',
  };
}

/**
 * Extracts a local JPEG poster frame (no re-encoding/trimming — future
 * work) and captures duration in ms from the picker's own metadata.
 * expo-video-thumbnails is deprecated as of SDK 57 in favor of
 * expo-video's own createVideoPlayer + generateThumbnailsAsync, used here
 * instead — the returned VideoThumbnail is a native image ref (not a saved
 * file), so it's piped through expo-image-manipulator to get a real,
 * persistable file:// URI.
 */
export async function prepareVideoForUpload(media: PickedMedia): Promise<PreparedUpload> {
  const player = createVideoPlayer(media.uri);
  let thumbnailLocalUri: string | null = null;
  try {
    const [thumbnail] = await player.generateThumbnailsAsync([0], { maxWidth: 400 });
    if (thumbnail) {
      const rendered = await ImageManipulator.manipulate(thumbnail).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
      thumbnailLocalUri = await persistToPendingUploads(saved.uri, 'jpg');
    }
  } finally {
    player.release();
  }

  const videoLocalUri = await persistToPendingUploads(media.uri, extensionFromUri(media.uri, 'mp4'));
  const file = new File(videoLocalUri);

  return {
    localUri: videoLocalUri,
    thumbnailLocalUri,
    width: media.width || null,
    height: media.height || null,
    durationMs: media.duration ?? null,
    sizeBytes: file.size,
    mimeType: media.mimeType ?? 'video/mp4',
  };
}

/**
 * Moves expo-audio's finalized recorder.uri into pendingUploads — same
 * durability contract as image/video's prepare functions. No downscaling or
 * thumbnail step (there's nothing to extract a poster frame from).
 */
export async function prepareVoiceForUpload(recordedUri: string, durationMs: number): Promise<PreparedUpload> {
  const localUri = await persistToPendingUploads(recordedUri, 'm4a');
  const file = new File(localUri);

  return {
    localUri,
    thumbnailLocalUri: null,
    width: null,
    height: null,
    durationMs,
    sizeBytes: file.size,
    mimeType: 'audio/m4a',
  };
}

async function putFile(localUri: string, mimeType: string, filename: string): Promise<string> {
  const { uploadUrl, key } = await getUploadUrl(filename, mimeType);
  await putFileToSignedUrl(localUri, uploadUrl, mimeType);
  return key;
}

/**
 * Fetches a *fresh* getUploadUrl immediately before each PUT — a 300s-expiry
 * mid-slow-upload is treated as an ordinary failure and retried with a new
 * key (see chatService.uploadAndSendMedia/resumePendingMediaUploads), no
 * chunked/multipart upload in v1. Uploads the thumbnail (video only) after
 * the main payload, as a separate key.
 *
 * Immediately seeds resolveMediaUri's read-path cache from the exact bytes
 * just uploaded (seedMediaCache), rather than leaving it to re-download the
 * same file from S3 the moment the caller flips MEDIA_CLOUD from the local
 * file:// placeholder to this key — that round trip (mint a download URL,
 * then re-fetch a potentially multi-MB file this process already has on
 * disk) is what made the bubble blank out and "jerk" back in right after
 * every send.
 */
export async function uploadPreparedMedia(
  prepared: PreparedUpload,
  kind: 'image' | 'video' | 'voice',
): Promise<UploadResult> {
  const mainExtension =
    kind === 'image' ? 'jpg' : kind === 'voice' ? 'm4a' : extensionFromUri(prepared.localUri, 'mp4');
  const mediaCloud = await putFile(prepared.localUri, prepared.mimeType, `${kind}-${Date.now()}.${mainExtension}`);
  await seedMediaCache(mediaCloud, prepared.localUri);

  let mediaThumbnail: string | null = null;
  if (prepared.thumbnailLocalUri) {
    mediaThumbnail = await putFile(prepared.thumbnailLocalUri, 'image/jpeg', `${kind}-thumb-${Date.now()}.jpg`);
    await seedMediaCache(mediaThumbnail, prepared.thumbnailLocalUri);
  }

  return { mediaCloud, mediaThumbnail };
}

/**
 * Moves the just-uploaded local file straight into resolveMediaUri's cache
 * directory, under the exact name it looks for. Best-effort: if the move
 * fails for any reason, resolveMediaUri's normal cache-miss path (mint a
 * download URL, fetch, cache) still covers it — this is purely an
 * optimization, never a correctness requirement.
 */
async function seedMediaCache(key: string, localUri: string): Promise<void> {
  const cacheFile = new File(mediaCacheDir(), encodeURIComponent(key));
  try {
    await new File(localUri).move(cacheFile);
  } catch (error) {
    if (__DEV__) console.log('[mediaUploadService] seedMediaCache move failed:', error);
  }
}

function mediaCacheDir(): Directory {
  const dir = new Directory(Paths.document, 'mediaCache');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Read path for IMAGE/VIDEO bubbles only — never retrofitted onto
 * sticker/GIF's existing uncached external-URL path. `file://` passthrough
 * covers a still-uploading own message; otherwise `cloudValue` is this
 * app's own S3 key (never a bare external URL, unlike sticker/GIF), so a
 * cache miss always means "fetch a fresh getDownloadUrl and cache it."
 */
export async function resolveMediaUri(cloudValue: string | null): Promise<string | null> {
  if (!cloudValue) return null;
  if (cloudValue.startsWith('file://')) return cloudValue;

  const cacheFile = new File(mediaCacheDir(), encodeURIComponent(cloudValue));
  if (fileExists(cacheFile)) return cacheFile.uri;

  const downloadUrl = await getDownloadUrl(cloudValue);
  const downloaded = await File.downloadFileAsync(downloadUrl, cacheFile, { idempotent: true });
  return downloaded.uri;
}

/**
 * `.exists` itself can throw (not just return false) for a malformed URI —
 * e.g. Android's `java.io.File(URI)` throwing IllegalArgumentException
 * "URI is not absolute" for a scheme-less string — so every read of it
 * goes through here instead of a bare property access.
 */
function fileExists(file: File): boolean {
  try {
    return file.exists;
  } catch (error) {
    if (__DEV__) console.log('[mediaUploadService] file.exists threw for', file.uri, error);
    return false;
  }
}

/** Used by chatService's resume path to tell "evicted, permanently failed" apart from "still there, retry." */
export function localFileExists(uri: string): boolean {
  if (!uri) return false;
  return fileExists(new File(toFileUri(uri)));
}

/** `125000 -> "2:05"` — VideoMessageContent.duration expects a ready-made string, not a number. */
export function msToClockString(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `"2:05" -> 125000` — inverse of msToClockString, for parsing ChatInputBar's onSendVoiceNote result. */
export function clockStringToMs(duration: string): number {
  const [minutes, seconds] = duration.split(':').map(Number);
  return ((minutes || 0) * 60 + (seconds || 0)) * 1000;
}
