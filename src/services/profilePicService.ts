import { Directory, File, Paths } from 'expo-file-system';
import type { ImageSourcePropType } from 'react-native';
import { Strophe } from 'react-native-strophe';
import { store } from '../store';
import { getProfilePicUploadUrl } from '@gameserver/getProfilePicUploadUrlApi';
import { getProfilePicDownloadUrl } from '@gameserver/getProfilePicDownloadUrlApi';
import { prepareImageForUpload, type PickedMedia } from '@media/mediaUploadService';
import { putFileToSignedUrl } from '@media/s3Upload';

/**
 * Orchestrates the profile-pic upload/download endpoints against an
 * on-disk cache, keyed by a stable per-user "bucket" id — not by the
 * signed download URL itself. getProfilePicDownloadUrl mints a brand-new
 * signed URL on every call even when the underlying photo hasn't changed,
 * so a cache keyed by that URL (e.g. expo-image's Image.prefetch, or RN
 * Image's own URL-keyed cache) can never hit — every resolve would
 * silently re-download the bytes from S3. Caching here instead by
 * `profile-<userId>-<bucket>` and checking the local file *before* ever
 * minting a download URL means a cache hit costs zero network calls, not
 * just zero redundant image decodes. See "cache-key freshness" in
 * profile-picture-upload-and-display plan for why the bucket itself is
 * hourly (other users) or an in-memory override (yourself, right after
 * upload) rather than a single permanently-stable key.
 */

const CACHE_BUCKET_MS = 60 * 60 * 1000; // 1 hour — stale-photo tolerance for *other* users' pics

/** In-memory only — resets on relaunch, which just falls back to the hourly bucket (self-corrects within the hour). */
let myProfilePicVersionOverride: number | null = null;

function myUserId(): number | null {
  const userId = Number(store.getState().auth.userId);
  return Number.isFinite(userId) ? userId : null;
}

function bucketFor(userId: number, isSelf: boolean): number {
  return isSelf && myProfilePicVersionOverride !== null
    ? myProfilePicVersionOverride
    : Math.floor(Date.now() / CACHE_BUCKET_MS);
}

function profilePicCacheDir(): Directory {
  const dir = new Directory(Paths.document, 'profilePicCache');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function cacheFileFor(userId: number, bucket: number): File {
  return new File(profilePicCacheDir(), `profile-${userId}-${bucket}.jpg`);
}

/**
 * `.exists` itself can throw for a malformed URI, same gotcha as
 * mediaUploadService.ts's identical helper — every read goes through here
 * instead of a bare property access.
 */
function fileExists(file: File): boolean {
  try {
    return file.exists;
  } catch {
    return false;
  }
}

/** Each new bucket mints a new filename, so without this, every hourly rollover (or self re-upload) would leave the previous bucket's file behind forever. */
function evictOtherCacheFilesFor(userId: number, keepFile: File): void {
  const prefix = `profile-${userId}-`;
  for (const entry of profilePicCacheDir().list()) {
    if (entry instanceof File && entry.name !== keepFile.name && entry.name.startsWith(prefix)) {
      try {
        entry.delete();
      } catch {
        // Best-effort cleanup — a leftover stale file is a disk-space nit, not a correctness issue.
      }
    }
  }
}

/**
 * Derives userId from jid with Strophe.getNodeFromJid (no network call —
 * JIDs are minted as `${userId}@${domain}`, same confirmed pattern as
 * identityService.ts). Cache hit short-circuits before any network call at
 * all; a miss mints a signed download URL and streams it straight to the
 * cache file (which also doubles as "did this actually load" validation —
 * downloadFileAsync rejects on a non-2xx response). Callers only ever see
 * a known-good local source, so every consumer's existing
 * initials/placeholder fallback stays correct with no extra onError
 * plumbing.
 */
export async function getProfilePicSource(jid: string | null): Promise<ImageSourcePropType | undefined> {
  if (!jid) return undefined;
  const userId = Number(Strophe.getNodeFromJid(jid));
  if (!Number.isFinite(userId)) return undefined;
  const isSelf = userId === myUserId();

  const cacheFile = cacheFileFor(userId, bucketFor(userId, isSelf));
  if (fileExists(cacheFile)) return { uri: cacheFile.uri };

  try {
    const downloadUrl = await getProfilePicDownloadUrl(isSelf ? undefined : userId);
    const downloaded = await File.downloadFileAsync(downloadUrl, cacheFile, { idempotent: true });
    evictOtherCacheFilesFor(userId, downloaded);
    return { uri: downloaded.uri };
  } catch {
    // Never-uploaded (404-shaped) or network failure — caller falls back to initials/placeholder.
    return undefined;
  }
}

/**
 * Takes an already-picked gallery asset (screen's job to open the picker),
 * downscales it via the same mediaUploadService primitive chat media uses,
 * uploads it to the profile-pic-specific presigned URL, then seeds the
 * *local* cache for the new self-override bucket directly from the
 * already-downscaled file — no redundant round-trip back through
 * getProfilePicDownloadUrl just to re-fetch bytes this process already
 * has — before bumping the override so the uploader sees their own new
 * photo immediately rather than waiting for the hourly cache bucket.
 */
export async function uploadMyProfilePic(asset: PickedMedia): Promise<void> {
  const prepared = await prepareImageForUpload(asset);
  const { uploadUrl } = await getProfilePicUploadUrl(prepared.mimeType);
  await putFileToSignedUrl(prepared.localUri, uploadUrl, prepared.mimeType);

  const userId = myUserId();
  const newBucket = Date.now();
  if (userId !== null) {
    const cacheFile = cacheFileFor(userId, newBucket);
    await new File(prepared.localUri).copy(cacheFile);
    evictOtherCacheFilesFor(userId, cacheFile);
  }
  myProfilePicVersionOverride = newBucket;
}
