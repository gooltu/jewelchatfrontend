import { useEffect, useRef, useState } from 'react';
import { getGameServerTimeDelta, parseServerTimestamp } from '@services/timeSyncService';

/**
 * Ticks down to `completedAt` (a UTC "YYYY-MM-DD HH:mm:ss" deadline),
 * corrected by the device/game-server clock offset (deltaGame) — not a
 * naive per-second decrement, so it can't drift from the real deadline.
 * Fires `onExpire` exactly once the first time it reaches zero, then holds
 * at "00:00". Returns "--:--" until the deadline/offset are resolved.
 */
export function useBombCountdown(completedAt: string | null, onExpire: () => void): { display: string } {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!completedAt) return undefined;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      const delta = (await getGameServerTimeDelta()) ?? 0;
      const deadline = parseServerTimestamp(completedAt);

      const tick = () => {
        if (cancelled) return;
        const remaining = Math.max(0, deadline - (Date.now() + delta));
        setRemainingMs(remaining);
        if (remaining <= 0 && !firedRef.current) {
          firedRef.current = true;
          onExpire();
        }
      };

      tick();
      interval = setInterval(tick, 1000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [completedAt, onExpire]);

  const totalSeconds = remainingMs !== null ? Math.floor(remainingMs / 1000) : null;
  const display =
    totalSeconds !== null
      ? `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
      : '--:--';

  return { display };
}
