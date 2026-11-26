import {
  conversationDisplayName,
  formatPhoneNumber,
  isUnknownSender,
  needsUnknownSenderPrompt,
} from './contactDisplay';

const unknown = {
  IS_GROUP: 0,
  CONTACT_NAME: null,
  PHONEBOOK_CONTACT_NAME: null,
  CONTACT_NUMBER: 919000000004,
  IS_BLOCKED: 0,
  IS_UNKNOWN_ACCEPTED: 0,
};

describe('formatPhoneNumber', () => {
  it('groups an Indian number', () => {
    expect(formatPhoneNumber(919000000004)).toBe('+91 90000 00004');
  });
  it('prefixes anything else with a plus', () => {
    expect(formatPhoneNumber(14155550100)).toBe('+14155550100');
  });
  it('returns null without a number', () => {
    expect(formatPhoneNumber(null)).toBeNull();
  });
});

describe('conversationDisplayName', () => {
  it('prefers names, then the number, then Unknown User', () => {
    expect(conversationDisplayName({ ...unknown, CONTACT_NAME: 'Team' })).toBe('Team');
    expect(conversationDisplayName({ ...unknown, PHONEBOOK_CONTACT_NAME: 'Asha' })).toBe('Asha');
    expect(conversationDisplayName(unknown)).toBe('+91 90000 00004');
    expect(conversationDisplayName({ ...unknown, CONTACT_NUMBER: null })).toBe('Unknown User');
    expect(conversationDisplayName(null)).toBe('Unknown User');
  });
});

describe('needsUnknownSenderPrompt', () => {
  it('is true for an undecided unknown 1:1 sender', () => {
    expect(isUnknownSender(unknown)).toBe(true);
    expect(needsUnknownSenderPrompt(unknown)).toBe(true);
  });
  it('is false for groups, named contacts, blocked or accepted chats', () => {
    expect(needsUnknownSenderPrompt({ ...unknown, IS_GROUP: 1 })).toBe(false);
    expect(needsUnknownSenderPrompt({ ...unknown, CONTACT_NAME: 'Team Jewel Chat' })).toBe(false);
    expect(needsUnknownSenderPrompt({ ...unknown, PHONEBOOK_CONTACT_NAME: 'Asha' })).toBe(false);
    expect(needsUnknownSenderPrompt({ ...unknown, IS_BLOCKED: 1 })).toBe(false);
    expect(needsUnknownSenderPrompt({ ...unknown, IS_UNKNOWN_ACCEPTED: 1 })).toBe(false);
  });
});
