import { getConnection, isConnected, onConnectionStatusChange } from '../chatserver/stropheClient';
import { getMessageById, markSubmitted } from '../database/messageRepository';
import { MSG_TYPE, type ChatMessage } from '../types/chat';
import { enqueueOutgoingMessage, flushPendingMessages } from './syncService';

// Minimal stanza builder: syncService only chains these and calls .tree().
jest.mock('react-native-strophe', () => {
  const builder: Record<string, unknown> = {};
  for (const name of ['c', 't', 'up', 'attrs']) builder[name] = () => builder;
  builder.tree = () => ({});
  return { $msg: () => builder };
});
jest.mock('../chatserver/receiptStanzas', () => ({
  withMediaElement: (s: unknown) => s,
  withReplyElement: (s: unknown) => s,
  withActiveChatState: (s: unknown) => s,
}));
jest.mock('../chatserver/stropheClient', () => ({
  getConnection: jest.fn(),
  isConnected: jest.fn(),
  onConnectionStatusChange: jest.fn(),
}));
jest.mock('../database/messageRepository', () => ({
  getPendingOutgoingMessages: jest.fn(),
  getMessageById: jest.fn(),
  markError: jest.fn(),
  markSubmitted: jest.fn(),
}));

const send = jest.fn();
let online = false;
// The "database": attemptSend re-reads the row, so tests mutate this.
let row: ChatMessage;

function pendingRow(): ChatMessage {
  return {
    _ID: 8,
    CHAT_ROOM_JID: '6@jewelchat.net',
    SENDER_MSG_ID: '8',
    MSG_TYPE: MSG_TYPE.TEXT,
    MSG_TEXT: 'Offline',
    IS_GROUP_MSG: 0,
    IS_FORWARD: 0,
    IS_REPLY: 0,
    REPLY_PARENT: null,
    IS_SUBMITTED: 0,
    IS_ERROR: 0,
  } as unknown as ChatMessage;
}

/** Lets the awaited DB calls inside attemptSend settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  online = false;
  row = pendingRow();
  (getConnection as jest.Mock).mockImplementation(() => ({ send }));
  (isConnected as jest.Mock).mockImplementation(() => online);
  (onConnectionStatusChange as jest.Mock).mockReturnValue(() => {});
  (getMessageById as jest.Mock).mockImplementation(async () => ({ ...row }));
  (markSubmitted as jest.Mock).mockImplementation(async () => {
    row = { ...row, IS_SUBMITTED: 1 };
  });
  const { getPendingOutgoingMessages } = jest.requireMock('../database/messageRepository');
  (getPendingOutgoingMessages as jest.Mock).mockImplementation(async () =>
    row.IS_SUBMITTED ? [] : [{ ...row }],
  );
});

afterEach(() => {
  jest.useRealTimers();
});

describe('syncService send queue', () => {
  it('sends a message queued while offline exactly once after reconnecting', async () => {
    enqueueOutgoingMessage(pendingRow());
    await settle();
    expect(send).not.toHaveBeenCalled();

    // First retry (2 s) also fails offline and schedules another (4 s).
    await jest.advanceTimersByTimeAsync(2_000);
    expect(send).not.toHaveBeenCalled();

    // Network back: the reconnect flush sends it.
    online = true;
    await flushPendingMessages();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    // The leftover retry timer must not send it again.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('ignores overlapping flushes for the same message', async () => {
    online = true;
    await Promise.all([flushPendingMessages(), flushPendingMessages()]);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('skips a stale copy whose row was already sent', async () => {
    online = true;
    row = { ...row, IS_SUBMITTED: 1 };
    enqueueOutgoingMessage(pendingRow());
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
