import { useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

/**
 * Live keyboard height, animated with the same event names/timing
 * ChatInputBar (@nocturnalflow/design-system) uses internally for its own
 * rise-above-keyboard translateY. ChatInputBar only repositions itself
 * (a transform, not a layout change), so without this a screen's message
 * list stays its original size and ends up covered as the input bar rises.
 * Applying this value as an animated `marginBottom` on the list container
 * shrinks it in lockstep instead.
 */
export function useKeyboardOffset(): SharedValue<number> {
  const keyboardOffset = useSharedValue(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      keyboardOffset.value = withTiming(e.endCoordinates.height, { duration: e.duration || 250 });
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      keyboardOffset.value = withTiming(0, { duration: e?.duration || 250 });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  return keyboardOffset;
}
