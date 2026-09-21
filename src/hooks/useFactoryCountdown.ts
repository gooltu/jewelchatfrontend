import { useEffect, useState } from 'react';
import { getGameServerTimeDelta } from '@services/timeSyncService';

interface FactoryCountdown {
  /** Seconds remaining, clamped at 0. Null until the game-server clock offset resolves. */
  remainingSeconds: number | null;
  /** "MM:SS", ticking every second — a whole-minutes label would sit unchanged for up to 59s at a time and read as frozen. "--:--" until resolved. */
  display: string;
  expired: boolean;
}

/**
 * Counts down a running factory's remaining duration from `startTimeMs`
 * (epoch ms — see UserFactory.start_time's doc comment on why every source
 * of this value is normalized to the same unit) + `durationSeconds`, using
 * the same game-server clock offset as useBombCountdown. Ticks every
 * second; clamps at 0 and stays there once expired rather than going
 * negative.
 */
export function useFactoryCountdown(
  startTimeMs: number | null,
  durationSeconds: number,
): FactoryCountdown {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    // `startTimeMs === null` needs no explicit reset here — the initial
    // state is already null, and the cleanup below resets it on any
    // non-null -> null transition (a running factory getting stopped).
    // Also bail on a non-finite value (e.g. an unparseable start_time
    // that slipped through) rather than let it produce a NaN deadline —
    // display already falls back to "--:--" whenever remainingSeconds
    // stays null, which is what should show instead of "NaN:NaN".
    if (startTimeMs === null || !Number.isFinite(startTimeMs)) return undefined;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const delta = (await getGameServerTimeDelta()) ?? 0;
      const deadline = startTimeMs + durationSeconds * 1000;
      const tick = () => {
        if (cancelled) return;
        setRemainingSeconds(Math.max(0, Math.round((deadline - (Date.now() + delta)) / 1000)));
      };
      tick();
      interval = setInterval(tick, 1000);
    })();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      setRemainingSeconds(null);
    };
  }, [startTimeMs, durationSeconds]);

  const display =
    remainingSeconds !== null
      ? `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`
      : '--:--';

  return { remainingSeconds, display, expired: remainingSeconds !== null && remainingSeconds <= 0 };
}
