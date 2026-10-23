import { getJewels } from '../gameserver/getJewelsApi';
import { store } from '../store';
import jewelPoolReducer from '../store/slices/jewelPoolSlice';
import { takeJewel, ensureJewelPoolReady } from './jewelPoolService';

jest.mock('../gameserver/getJewelsApi', () => ({ getJewels: jest.fn() }));
jest.mock('../store', () => ({
  store: { getState: jest.fn(), dispatch: jest.fn() },
}));

const mockedGetJewels = getJewels as jest.MockedFunction<typeof getJewels>;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

// Backed by the real reducer (not a dumb stub) so dispatches actually mutate what
// getState sees next, but re-seeded fresh in beforeEach — unlike a module-level
// store, this keeps every test isolated without needing jest.resetModules().
let state: ReturnType<typeof jewelPoolReducer>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

  state = jewelPoolReducer(undefined, { type: '@@INIT' });
  (store.getState as jest.Mock).mockImplementation(() => ({ jewelPool: state }));
  (store.dispatch as jest.Mock).mockImplementation((action) => {
    state = jewelPoolReducer(state, action);
    return action;
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('jewelPoolService.takeJewel', () => {
  it('pops the head jewel and its batch code off the pool', () => {
    state = jewelPoolReducer(state, {
      type: 'jewelPool/jewelBatchReceived',
      payload: { jewels: [6, 9], code: 'batch-code' },
    });

    const result = takeJewel();

    expect(result).toEqual({ jeweltypeId: 6, code: 'batch-code' });
    expect(state.pool).toEqual([9]);
  });

  it('returns null immediately when the pool is empty, without waiting on the network, and refills it in the background', async () => {
    mockedGetJewels.mockResolvedValue({ jewels: [3, 6], code: 'new-code' });

    const result = takeJewel();

    expect(result).toBeNull();
    expect(mockedGetJewels).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(0);
    expect(state.pool).toEqual([3, 6]);
    expect(state.code).toBe('new-code');
  });

  it('does not call /getJewels again within the 15-minute cooldown, even while the pool stays empty', async () => {
    mockedGetJewels.mockResolvedValue(null); // pool never gets refilled, stays empty

    takeJewel();
    takeJewel(); // same tick — must not pile up a second request either
    await jest.advanceTimersByTimeAsync(0);
    expect(mockedGetJewels).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(FIFTEEN_MIN_MS - 1);
    takeJewel();

    expect(mockedGetJewels).toHaveBeenCalledTimes(1);
  });

  it('records the attempt even on failure, so the cooldown still applies', async () => {
    mockedGetJewels.mockResolvedValue(null);

    takeJewel();
    await jest.advanceTimersByTimeAsync(0);

    expect(state.lastFetchedAt).toBe(Date.now());
    expect(state.pool).toEqual([]);
  });

  it('allows a new call once the 15-minute cooldown has elapsed', async () => {
    mockedGetJewels.mockResolvedValueOnce(null);
    takeJewel();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockedGetJewels).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(FIFTEEN_MIN_MS + 1);
    mockedGetJewels.mockResolvedValueOnce({ jewels: [9], code: 'c2' });
    takeJewel();

    expect(mockedGetJewels).toHaveBeenCalledTimes(2);
  });
});

describe('jewelPoolService.ensureJewelPoolReady', () => {
  it('resolves without calling /getJewels when the pool already has jewels', async () => {
    state = jewelPoolReducer(state, {
      type: 'jewelPool/jewelBatchReceived',
      payload: { jewels: [6], code: 'batch-code' },
    });

    await ensureJewelPoolReady();

    expect(mockedGetJewels).not.toHaveBeenCalled();
  });

  it('awaits a refill when the pool is empty, so jewels are ready as soon as it resolves', async () => {
    mockedGetJewels.mockResolvedValue({ jewels: [3, 6], code: 'new-code' });

    await ensureJewelPoolReady();

    expect(mockedGetJewels).toHaveBeenCalledTimes(1);
    expect(state.pool).toEqual([3, 6]);
    expect(state.code).toBe('new-code');
  });

  it('resolves even if the refill fails, leaving the pool empty for the caller to handle', async () => {
    mockedGetJewels.mockResolvedValue(null);

    await ensureJewelPoolReady();

    expect(state.pool).toEqual([]);
  });
});
