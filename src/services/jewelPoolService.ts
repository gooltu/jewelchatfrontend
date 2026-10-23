import { getJewels } from '../gameserver/getJewelsApi';
import { store } from '../store';
import {
  jewelBatchReceived,
  jewelFetchAttempted,
  jewelTaken,
} from '../store/slices/jewelPoolSlice';

/** Backend requires at least this long between consecutive GET /getJewels calls. */
const MIN_FETCH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Takes one jewel off the local pool for immediate attachment to an incoming message.
 * Purely synchronous (a Redux read + optional dispatch) by design — callers in
 * chatService.ts/stropheEvents.ts must never await this, so message persistence and
 * rendering never wait on a network round trip. Returns null if the pool is empty —
 * the caller attaches no jewel to that message — and kicks off a best-effort
 * background refill for subsequent messages.
 */
export function takeJewel(): { jeweltypeId: number; code: string } | null {
  const state = store.getState().jewelPool;
  if (state.pool.length === 0) {
    void replenishJewelPool();
    return null;
  }
  const jeweltypeId = state.pool[0] as number;
  const code = state.code as string;
  store.dispatch(jewelTaken());
  return { jeweltypeId, code };
}

/**
 * Awaits a pool refill if it's currently empty — unlike takeJewel()'s fire-and-forget
 * replenish, this is for the rare call site that must have real jewels ready
 * *before* it inserts anything, rather than falling back to "no jewel this time"
 * (see chatService.seedWelcomeContact, which calls this before seeding the
 * first-run welcome messages so they can carry real server-issued jewels). Still
 * subject to the same MIN_FETCH_INTERVAL_MS cooldown as every other caller.
 */
export async function ensureJewelPoolReady(): Promise<void> {
  if (store.getState().jewelPool.pool.length > 0) return;
  await replenishJewelPool();
}

/**
 * Best-effort refill of the jewel pool from GET /getJewels, fired only when
 * takeJewel() finds the pool empty (reactive, no proactive prefetch). Enforces
 * MIN_FETCH_INTERVAL_MS between calls — checked against the persisted
 * `lastFetchedAt` so the gap holds even across an app restart. jewelFetchAttempted
 * is dispatched synchronously before the request resolves, so it also closes the
 * window for a second call piling up concurrently in the same tick.
 */
async function replenishJewelPool(): Promise<void> {
  const { lastFetchedAt } = store.getState().jewelPool;
  if (lastFetchedAt !== null && Date.now() - lastFetchedAt < MIN_FETCH_INTERVAL_MS) return;
  store.dispatch(jewelFetchAttempted());
  try {
    const result = await getJewels();
    if (result && result.jewels.length > 0) {
      store.dispatch(jewelBatchReceived(result));
    }
  } catch {
    // best-effort — lastFetchedAt is already recorded, so the 15-minute cooldown
    // applies the same whether this call succeeded or failed.
  }
}
