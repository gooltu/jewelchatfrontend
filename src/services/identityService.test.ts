import { downloadContactById } from '../gameserver/contactLookupApi';
import { resolveGroupMemberDisplayName } from './identityService';

// jest.mock calls are hoisted above these imports by babel-jest.
// Strophe's real JID helpers, inlined: the package can't load under jest.
jest.mock('react-native-strophe', () => ({
  Strophe: {
    getNodeFromJid: (jid: string) => (jid.includes('@') ? jid.split('@')[0] : null),
    getResourceFromJid: (jid: string) => {
      const i = jid.indexOf('/');
      return i < 0 ? null : jid.slice(i + 1);
    },
  },
}));
jest.mock('../gameserver/contactLookupApi', () => ({
  downloadContactById: jest.fn(async (userId: number) => ({
    jewelchatId: userId,
    phone: '9000000001',
    name: 'ignored',
  })),
}));
jest.mock('../database/contactRepository', () => ({ getContactByNumber: jest.fn(async () => null) }));
jest.mock('../database/resolvedIdentityRepository', () => ({
  getResolvedIdentity: jest.fn(async () => null),
  upsertResolvedIdentity: jest.fn(async () => undefined),
}));

describe('resolveGroupMemberDisplayName', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves the member from a MUC-Light occupant JID, not the room id', async () => {
    const name = await resolveGroupMemberDisplayName(
      '1795-629911-546769@muclight.jewelchat.net/5@jewelchat.net',
    );
    expect(downloadContactById).toHaveBeenCalledWith(5);
    expect(name).toBe('9000000001');
  });

  it('still resolves a bare member JID', async () => {
    await resolveGroupMemberDisplayName('7@jewelchat.net');
    expect(downloadContactById).toHaveBeenCalledWith(7);
  });
});
