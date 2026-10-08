import { useMemo } from 'react';
import { X } from 'lucide-react-native';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStyles, type ThemeColors, spacing } from '@components/design-system';
import { useResolvedMediaUri } from '@hooks/useResolvedMediaUri';
import type { RootScreenProps } from '@navigation/types';

const MAX_SCALE = 4;
const DISMISS_THRESHOLD = 120;

/**
 * One unified full-screen modal route (navigation/types.ts's RootStackParamList),
 * branching internally on `kind` rather than two separate screens — the
 * route param carries the S3 key/thumbnailKey, not a resolved URI
 * (durable/serializable); this screen re-resolves independently via
 * useResolvedMediaUri, same as the bubble. Video never autoplays inline in
 * the message list, only here.
 */
export function MediaViewerScreen({ route, navigation }: RootScreenProps<'MediaViewer'>) {
  const { params } = route;
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.container}>
      {params.kind === 'image' ? (
        <ImageViewer mediaKey={params.key} onDismiss={navigation.goBack} />
      ) : (
        <VideoViewer mediaKey={params.key} onDismiss={navigation.goBack} />
      )}
      <SafeAreaView style={styles.closeWrap} edges={['top']}>
        <Pressable onPress={navigation.goBack} hitSlop={12} style={styles.closeButton}>
          <X size={24} strokeWidth={2} color="#FFFFFF" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

/** Pinch-to-zoom + pan-while-zoomed, swipe-down-to-dismiss when at rest (scale ~1). */
function ImageViewer({ mediaKey, onDismiss }: { mediaKey: string; onDismiss: () => void }) {
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const uri = useResolvedMediaUri(mediaKey);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          scale.set(Math.min(MAX_SCALE, Math.max(1, savedScale.get() * e.scale)));
        })
        .onEnd(() => {
          savedScale.set(scale.get());
          if (scale.get() === 1) {
            translateX.set(withSpring(0));
            translateY.set(withSpring(0));
            savedTranslateX.set(0);
            savedTranslateY.set(0);
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          if (scale.get() > 1) {
            translateX.set(savedTranslateX.get() + e.translationX);
            translateY.set(savedTranslateY.get() + e.translationY);
          } else {
            translateY.set(e.translationY);
          }
        })
        .onEnd((e) => {
          if (scale.get() > 1) {
            savedTranslateX.set(translateX.get());
            savedTranslateY.set(translateY.get());
            return;
          }
          if (Math.abs(e.translationY) > DISMISS_THRESHOLD || Math.abs(e.velocityY) > 800) {
            runOnJS(onDismiss)();
            return;
          }
          translateY.set(withSpring(0));
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDismiss],
  );

  const composed = useMemo(() => Gesture.Simultaneous(pinch, pan), [pinch, pan]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.get() },
      { translateY: translateY.get() },
      { scale: scale.get() },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[styles.flexFill, animatedStyle]}>
        <Image
          source={uri ? { uri } : undefined}
          style={{ width, height }}
          contentFit="contain"
          placeholder={null}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/** Native play/pause/seek/mute via VideoView's built-in controls — no custom scrubber needed. */
function VideoViewer({ mediaKey, onDismiss }: { mediaKey: string; onDismiss: () => void }) {
  void onDismiss;
  const styles = useStyles(makeStyles);
  const uri = useResolvedMediaUri(mediaKey);
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });

  return <VideoView style={styles.flexFill} player={player} nativeControls contentFit="contain" />;
}

const makeStyles = (_colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000000' },
    flexFill: { flex: 1 },
    closeWrap: { position: 'absolute', top: 0, left: 0 },
    closeButton: {
      margin: spacing.sm,
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
  });
