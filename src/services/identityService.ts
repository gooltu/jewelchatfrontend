import { Strophe } from 'react-native-strophe';
import { downloadContactById } from '../gameserver/contactLookupApi';
import { getContactByNumber } from '../database/contactRepository';
import { getResolvedIdentity, upsertResolvedIdentity } from '../database/resolvedIdentityRepository';

/**
 * In-memory, session-lifetime memoization on top of the SQLite cache below
 * — a chat room can render many message rows from the same sender, each
 * independently calling this; without this, every single one would still
 * hit SQLite (cheap, but redundant) or momentarily flicker unresolved while
 * a concurrent request for the same JID is already in flight.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * Resolves a group member's JID into a display string, never a raw JID —
 * JIDs are minted as `${userId}@${domain}` (see authService.ts), so the
 * node is the game server's userid. Cached locally in ResolvedIdentity so a
 * chatty group doesn't re-hit the game server per message.
 *
 * Display rule (explicit product decision): a local phonebook match wins
 * as `PhonebookName(phone)`; otherwise the phone number alone — the game
 * server's own `name` field is fetched but deliberately never shown.
 * Best-effort throughout: any failure falls back to the raw JID rather than
 * blocking whatever's rendering it.
 */
export function resolveGroupMemberDisplayName(jid: string): Promise<string> {
  const existing = inFlight.get(jid);
  if (existing) return existing;

  const promise = resolveGroupMemberDisplayNameUncached(jid).finally(() => inFlight.delete(jid));
  inFlight.set(jid, promise);
  return promise;
}

async function resolveGroupMemberDisplayNameUncached(jid: string): Promise<string> {
  const cached = await getResolvedIdentity(jid);
  if (cached?.PHONE) return formatFromPhone(cached.PHONE);

  const userId = Number(Strophe.getNodeFromJid(jid));
  if (!Number.isFinite(userId)) return jid; // defensive — shouldn't happen, JIDs are always `${userId}@${domain}`

  const result = await downloadContactById(userId).catch(() => null);
  if (!result) return jid;

  await upsertResolvedIdentity({
    jid,
    jewelchatId: result.jewelchatId,
    phone: result.phone,
    name: result.name,
    resolvedTime: Date.now(),
  });
  return formatFromPhone(result.phone);
}

async function formatFromPhone(phone: string): Promise<string> {
  const phoneNumber = Number(phone);
  const match = Number.isFinite(phoneNumber) ? await getContactByNumber(phoneNumber) : null;
  return match?.PHONEBOOK_CONTACT_NAME ? `${match.PHONEBOOK_CONTACT_NAME}(${phone})` : phone;
}
