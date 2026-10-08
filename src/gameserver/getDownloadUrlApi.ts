import { gameserverClient } from './client';

/**
 * Wraps POST /getDownloadUrl — mints a presigned S3 GET URL for an existing
 * key. Confirmed by the user to have no cross-user ownership restriction:
 * any authenticated user holding the exact key can fetch it, which is what
 * makes group-chat media viewing possible.
 */

interface GetDownloadUrlResponse {
  error: boolean;
  message?: string;
  downloadUrl?: string;
}

/** Throws on `error`/malformed response — callers (mediaUploadService.ts) treat that as an ordinary download failure. */
export async function getDownloadUrl(key: string): Promise<string> {
  const { data } = await gameserverClient.post<GetDownloadUrlResponse>('/getDownloadUrl', { key });
  if (data.error || !data.downloadUrl) {
    throw new Error(data.message ?? 'getDownloadUrl failed');
  }
  return data.downloadUrl;
}
