import { gameserverClient } from './client';

/** Wraps POST /getUploadUrl — mints a presigned S3 PUT URL for a new media upload. */

interface GetUploadUrlResponse {
  error: boolean;
  message?: string;
  uploadUrl?: string;
  key?: string;
}

export interface UploadUrlResult {
  uploadUrl: string;
  key: string;
}

/** Throws on `error`/malformed response — callers (mediaUploadService.ts) treat that as an ordinary upload failure. */
export async function getUploadUrl(filename: string, contentType: string): Promise<UploadUrlResult> {
  const { data } = await gameserverClient.post<GetUploadUrlResponse>('/getUploadUrl', {
    filename,
    contentType,
  });
  if (data.error || !data.uploadUrl || !data.key) {
    throw new Error(data.message ?? 'getUploadUrl failed');
  }
  return { uploadUrl: data.uploadUrl, key: data.key };
}
