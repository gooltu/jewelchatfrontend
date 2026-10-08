import { gameserverClient } from './client';

/**
 * Wraps POST /getProfilePicUploadUrl — mints a presigned S3 PUT URL for the
 * caller's own profile picture, at a deterministic per-user key
 * (`uploads/<userId>/profile`, overwritten on every re-upload). No
 * `filename` param — the backend contract ignores one even if sent, unlike
 * the chat-media getUploadUrl endpoint.
 */

interface GetProfilePicUploadUrlResponse {
  error: boolean;
  message?: string;
  uploadUrl?: string;
  key?: string;
}

export interface ProfilePicUploadUrlResult {
  uploadUrl: string;
  key: string;
}

/** Throws on `error`/malformed response — callers (profilePicService.ts) treat that as an ordinary upload failure. */
export async function getProfilePicUploadUrl(contentType: string): Promise<ProfilePicUploadUrlResult> {
  const { data } = await gameserverClient.post<GetProfilePicUploadUrlResponse>('/getProfilePicUploadUrl', {
    contentType,
  });
  if (data.error || !data.uploadUrl || !data.key) {
    throw new Error(data.message ?? 'getProfilePicUploadUrl failed');
  }
  return { uploadUrl: data.uploadUrl, key: data.key };
}
