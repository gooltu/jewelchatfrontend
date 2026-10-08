import { File, UploadType } from 'expo-file-system';

/**
 * Shared streaming-PUT primitive against an already-minted presigned S3
 * URL. Factored out of mediaUploadService.ts so profilePicService.ts (a
 * separate upload flow, different presigned-URL endpoint) doesn't
 * duplicate the streaming logic — see profile-picture-upload-and-display
 * plan's cross-reference note. Callers own minting the URL (the two
 * endpoints — chat media's `getUploadUrl` vs profile pic's
 * `getProfilePicUploadUrl` — have different request shapes) and own
 * retry/expiry handling; this only streams the one file.
 */
export async function putFileToSignedUrl(
  localUri: string,
  uploadUrl: string,
  mimeType: string,
): Promise<void> {
  const file = new File(localUri);
  const response = await file.upload(uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mimeType },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`S3 PUT failed with status ${response.status}`);
  }
}
