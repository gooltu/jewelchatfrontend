import { deriveMessageStatus } from './messageRepository';

describe('deriveMessageStatus', () => {
  it('returns pending when no status flag is set', () => {
    expect(
      deriveMessageStatus({ IS_SUBMITTED: 0, IS_DELIVERED: 0, IS_READ: 0, IS_ERROR: 0 }),
    ).toBe('pending');
  });

  it('returns sent once submitted', () => {
    expect(
      deriveMessageStatus({ IS_SUBMITTED: 1, IS_DELIVERED: 0, IS_READ: 0, IS_ERROR: 0 }),
    ).toBe('sent');
  });

  it('returns delivered once the delivered flag is set', () => {
    expect(
      deriveMessageStatus({ IS_SUBMITTED: 1, IS_DELIVERED: 1, IS_READ: 0, IS_ERROR: 0 }),
    ).toBe('delivered');
  });

  it('returns read once the read flag is set', () => {
    expect(
      deriveMessageStatus({ IS_SUBMITTED: 1, IS_DELIVERED: 1, IS_READ: 1, IS_ERROR: 0 }),
    ).toBe('read');
  });

  it('returns failed when IS_ERROR is set, regardless of other flags', () => {
    expect(
      deriveMessageStatus({ IS_SUBMITTED: 1, IS_DELIVERED: 1, IS_READ: 1, IS_ERROR: 1 }),
    ).toBe('failed');
  });
});
