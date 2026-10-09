import { useEffect } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

export interface VoicePlayback {
  playing: boolean;
  /** 0-1 playback position, matches VoiceMessageContent.progress. */
  progress: number;
  toggle: () => void;
}

/**
 * Module-level subscriber set, not component state, since "pause every other
 * bubble" needs to reach across sibling MessageBubbleRow instances. Playing
 * one voice bubble pauses whichever other one was playing
 * (single-active-playback UX, like WhatsApp/iMessage), rather than every
 * bubble running an independent player. No need to track the active id
 * itself — each broadcast already carries it, and a freshly-mounted bubble
 * has nothing to catch up on since its own player starts paused.
 */
const listeners = new Set<(activeId: number) => void>();

function setActive(id: number): void {
  listeners.forEach((listener) => listener(id));
}

/**
 * Per-voice-bubble playback, backed by expo-audio. `resolvedUri` is null for
 * non-voice rows and before useResolvedMediaUri finishes — the hook is
 * always called (same unconditional-hook-order pattern useResolvedMediaUri
 * itself relies on) and is a harmless no-op in that state (expo-audio
 * accepts a null source and reports a non-playing, zero-duration status).
 */
export function useVoicePlayback(messageId: number, resolvedUri: string | null): VoicePlayback {
  const player = useAudioPlayer(resolvedUri);
  const status = useAudioPlayerStatus(player);

  // Some other bubble became active (its own toggle() called setActive) —
  // pause this one so only one voice note ever plays at a time.
  useEffect(() => {
    const onActiveChange = (activeId: number) => {
      if (activeId !== messageId && status.playing) player.pause();
    };
    listeners.add(onActiveChange);
    return () => {
      listeners.delete(onActiveChange);
    };
  }, [messageId, player, status.playing]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    setActive(messageId);
    player.play();
  };

  return {
    playing: status.playing,
    progress: status.duration > 0 ? status.currentTime / status.duration : 0,
    toggle,
  };
}
