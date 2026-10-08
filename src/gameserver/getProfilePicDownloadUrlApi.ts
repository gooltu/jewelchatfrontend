import { gameserverClient } from './client';

/**
 * Wraps POST /getProfilePicDownloadUrl — mints a presigned S3 GET URL for a
 * user's profile picture. No ownership restriction (same as chat media's
 * getDownloadUrl): any authenticated user can view any other user's pic.
 * `userId` is omitted entirely from the request body for "my own" picture
 * — per the backend contract, not sent as `undefined`/`null`.
 */

interface GetProfilePicDownloadUrlResponse {
  error: boolean;
  message?: string;
  downloadUrl?: string;
}

/** Throws on `error`/malformed response (including "never uploaded" — a 404-shaped failure) — callers (profilePicService.ts) fall back to initials/placeholder. */
export async function getProfilePicDownloadUrl(userId?: number): Promise<string> {
  const { data } = await gameserverClient.post<GetProfilePicDownloadUrlResponse>(
    '/getProfilePicDownloadUrl',
    userId === undefined ? {} : { userId },
  );
  if (data.error || !data.downloadUrl) {
    throw new Error(data.message ?? 'getProfilePicDownloadUrl failed');
  }
  return data.downloadUrl;
}
