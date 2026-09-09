import { gameserverClient } from './client';

/**
 * Phone-number + OTP sign-up contract — distinct from authApi.ts's old
 * JID-issuing username/password contract. Kept in a separate file so the
 * new /getAccessToken (refreshToken -> accessToken) isn't conflated with
 * authApi.ts's old, unused /auth/refresh (refreshToken -> AuthTokens).
 */

export interface RegisterPhoneNumberResponse {
  error: boolean;
  message?: string;
  userId: number;
  active: boolean;
  name: string;
  status_msg: string;
  domain: string;
}

export interface VerifyCodeResponse {
  error: boolean;
  message?: string;
  refreshToken: string;
}

export interface GetAccessTokenResponse {
  error: boolean;
  message?: string;
  accessToken: string;
}

export interface InitialDetailsResponse {
  error: boolean;
  message?: string;
}

export interface ResendVcodeResponse {
  error: boolean;
  message?: string;
}

/** `phone` must already be the concatenated country-code+number, no plus/separator (e.g. "919330251439"). */
export async function registerPhoneNumber(phone: string): Promise<RegisterPhoneNumberResponse> {
  const { data } = await gameserverClient.post<RegisterPhoneNumberResponse>('/registerPhoneNumber', {
    phone,
  });
  if (data.error) throw new Error(data.message || 'registerPhoneNumber failed'); // TODO: confirm vs real backend whether error:true ever coincides with HTTP 2xx
  return data;
}

export async function verifyCode(userId: number, verificationCode: string): Promise<VerifyCodeResponse> {
  const { data } = await gameserverClient.post<VerifyCodeResponse>('/verifyCode', {
    userId,
    verificationCode,
  });
  if (data.error) throw new Error(data.message || 'verifyCode failed');
  return data;
}

export async function getAccessToken(refreshToken: string): Promise<GetAccessTokenResponse> {
  const { data } = await gameserverClient.post<GetAccessTokenResponse>('/getAccessToken', {
    refreshToken,
  });
  if (data.error) throw new Error(data.message || 'getAccessToken failed');
  return data;
}

export async function initialDetails(reference: string, name: string): Promise<InitialDetailsResponse> {
  const { data } = await gameserverClient.post<InitialDetailsResponse>('/initialDetails', {
    reference,
    name,
  });
  if (data.error) throw new Error(data.message || 'initialDetails failed');
  return data;
}

export async function resendVcode(userId: number): Promise<ResendVcodeResponse> {
  const { data } = await gameserverClient.post<ResendVcodeResponse>('/resendVcode', { userId });
  if (data.error) throw new Error(data.message || 'resendVcode failed');
  return data;
}
