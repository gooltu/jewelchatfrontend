import * as contactRepository from '@database/contactRepository';
import * as chatService from './chatService';
import * as contactSyncService from './contactSyncService';
import {
  acceptUnknownSender,
  addUnknownSenderToContacts,
  blockContact,
  unblockContact,
} from './unknownSenderService';

// jest.mock calls are hoisted above these imports by babel-jest.
jest.mock('@database/contactRepository', () => ({
  getContactByJid: jest.fn(),
  setBlocked: jest.fn(async () => undefined),
  setUnknownAccepted: jest.fn(async () => undefined),
}));
jest.mock('./chatService', () => ({
  notifyRoom: jest.fn(),
  addToRosterAndSubscribe: jest.fn(),
}));
jest.mock('./contactSyncService', () => ({
  presentCreateContactForm: jest.fn(),
  syncPhonebook: jest.fn(async () => undefined),
}));

const JID = '42@jewelchat.net';
const getContactByJid = contactRepository.getContactByJid as jest.Mock;
const presentCreateContactForm = contactSyncService.presentCreateContactForm as jest.Mock;

describe('unknownSenderService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('continue marks the chat accepted and refreshes it', async () => {
    await acceptUnknownSender(JID);
    expect(contactRepository.setUnknownAccepted).toHaveBeenCalledWith(JID);
    expect(chatService.notifyRoom).toHaveBeenCalledWith(JID);
  });

  it('block and unblock flip IS_BLOCKED locally', async () => {
    await blockContact(JID);
    expect(contactRepository.setBlocked).toHaveBeenCalledWith(JID, true);
    await unblockContact(JID);
    expect(contactRepository.setBlocked).toHaveBeenCalledWith(JID, false);
    expect(chatService.notifyRoom).toHaveBeenCalledTimes(2);
  });

  it('add does nothing without a known number', async () => {
    getContactByJid.mockResolvedValueOnce({ CONTACT_NUMBER: null });
    await expect(addUnknownSenderToContacts(JID)).resolves.toBe('no-number');
    expect(presentCreateContactForm).not.toHaveBeenCalled();
  });

  it('add pre-fills the number, re-syncs, subscribes and accepts once saved', async () => {
    getContactByJid
      .mockResolvedValueOnce({ CONTACT_NUMBER: 919000000004, PHONEBOOK_CONTACT_NAME: null })
      .mockResolvedValueOnce({ CONTACT_NUMBER: 919000000004, PHONEBOOK_CONTACT_NAME: 'Asha' });
    presentCreateContactForm.mockResolvedValueOnce(true);

    await expect(addUnknownSenderToContacts(JID)).resolves.toBe('added');
    expect(presentCreateContactForm).toHaveBeenCalledWith(919000000004);
    expect(contactSyncService.syncPhonebook).toHaveBeenCalled();
    expect(chatService.addToRosterAndSubscribe).toHaveBeenCalledWith(JID, 'Asha');
    expect(contactRepository.setUnknownAccepted).toHaveBeenCalledWith(JID);
  });

  it('add leaves the prompt up when the form is cancelled', async () => {
    getContactByJid.mockResolvedValue({
      CONTACT_NUMBER: 919000000004,
      PHONEBOOK_CONTACT_NAME: null,
    });
    presentCreateContactForm.mockResolvedValueOnce(false);

    await expect(addUnknownSenderToContacts(JID)).resolves.toBe('cancelled');
    expect(chatService.addToRosterAndSubscribe).not.toHaveBeenCalled();
    expect(contactRepository.setUnknownAccepted).not.toHaveBeenCalled();
  });
});
