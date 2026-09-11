import { gameserverClient } from './client';

/**
 * Wraps /downloadContact_Phone — looks up a single phone number's JewelChat
 * status. `phone` must already be the concatenated country-code+number, no
 * plus/separator, matching phoneAuthApi.ts's registerPhoneNumber convention.
 */

interface DownloadContactPhoneResponse {
  error: boolean;
  message?: string;
  contact?: {
    id: number;
    name: string | null;
    phone: string;
    status: string | null;
    active: boolean;
  };
}

export interface ContactLookupResult {
  jewelchatId: number;
  name: string | null;
  phone: string;
  status: string | null;
}

/** Returns null when the phone isn't a registered/active JewelChat user (error, empty, or active:false). */
export async function downloadContactByPhone(phone: string): Promise<ContactLookupResult | null> {
  const { data } = await gameserverClient.post<DownloadContactPhoneResponse>(
    '/downloadContact_Phone',
    { phone },
  );
  if (data.error || !data.contact || !data.contact.active) return null;
  return {
    jewelchatId: data.contact.id,
    name: data.contact.name,
    phone: data.contact.phone,
    status: data.contact.status,
  };
}

/**
 * Wraps /downloadContact — looks up a JewelChat user by their small
 * integer userid (the JID's node — JIDs are minted client-side as
 * `${userId}@${domain}`, see authService.ts). Same response shape as
 * downloadContactByPhone, minus an `active` field (not present on this
 * endpoint's response), so there's no activity check here.
 */
interface DownloadContactByIdResponse {
  error: boolean;
  message?: string;
  contact?: {
    id: number;
    name: string | null;
    phone: string;
    status: string | null;
  };
}

export async function downloadContactById(userId: number): Promise<ContactLookupResult | null> {
  const { data } = await gameserverClient.post<DownloadContactByIdResponse>('/downloadContact', {
    id: userId,
  });
  if (data.error || !data.contact) return null;
  return {
    jewelchatId: data.contact.id,
    name: data.contact.name,
    phone: data.contact.phone,
    status: data.contact.status,
  };
}
