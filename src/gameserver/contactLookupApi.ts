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
