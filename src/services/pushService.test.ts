import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { disablePush, enablePush } from '@chatserver/push';
import {
  ensurePushRegistered,
  getPushNodeId,
  resetPushServiceForTests,
  unregisterPush,
} from './pushService';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
  };
});
jest.mock('@chatserver/push', () => ({
  enablePush: jest.fn().mockResolvedValue(undefined),
  disablePush: jest.fn().mockResolvedValue(undefined),
}));

let mockTokenListener: ((token: { data: unknown }) => void) | null = null;
const mockRemoveTokenListener = jest.fn();
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  addPushTokenListener: jest.fn((listener: (token: { data: unknown }) => void) => {
    mockTokenListener = listener;
    return { remove: mockRemoveTokenListener };
  }),
}));

const N = Notifications as jest.Mocked<typeof Notifications>;
const JID = '42@jewelchat.net';

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPushServiceForTests();
  mockTokenListener = null;
  N.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true } as never);
  N.getDevicePushTokenAsync.mockResolvedValue({ type: 'android', data: 'fcm-1' } as never);
});

test('node id is created once and reused', async () => {
  const first = await getPushNodeId();
  expect(first).toMatch(/^jc-[0-9a-f]{32}$/);
  expect(await getPushNodeId()).toBe(first);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

test('registers the FCM token over XMPP on connect', async () => {
  await ensurePushRegistered(JID);
  expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('messages', expect.objectContaining({ name: 'Messages' }));
  expect(enablePush).toHaveBeenCalledWith(JID, await getPushNodeId(), 'fcm-1');
});

test('asks for permission when not yet granted, and skips enable on denial', async () => {
  N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true } as never);
  N.requestPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
  await ensurePushRegistered(JID);
  expect(N.requestPermissionsAsync).toHaveBeenCalled();
  expect(enablePush).not.toHaveBeenCalled();
});

test('a rotated FCM token re-enables with the new token', async () => {
  await ensurePushRegistered(JID);
  (enablePush as jest.Mock).mockClear();
  mockTokenListener?.({ data: 'fcm-2' });
  await settle();
  expect(enablePush).toHaveBeenCalledWith(JID, expect.any(String), 'fcm-2');
  expect(N.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
});

test('the listener echo of the token being registered is ignored', async () => {
  await ensurePushRegistered(JID);
  (enablePush as jest.Mock).mockClear();
  mockTokenListener?.({ data: 'fcm-1' });
  await settle();
  expect(enablePush).not.toHaveBeenCalled();
});

test('enable failure never throws into the connect path', async () => {
  (enablePush as jest.Mock).mockRejectedValueOnce(new Error('enablePush: failed or timed out'));
  await expect(ensurePushRegistered(JID)).resolves.toBeUndefined();
});

test('logout disables the subscription and stops listening for token changes', async () => {
  await ensurePushRegistered(JID);
  await unregisterPush();
  expect(disablePush).toHaveBeenCalledWith(JID, await getPushNodeId());
  expect(mockRemoveTokenListener).toHaveBeenCalled();
  (disablePush as jest.Mock).mockClear();
  await unregisterPush();
  expect(disablePush).not.toHaveBeenCalled();
});
