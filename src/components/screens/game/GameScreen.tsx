import { useCallback, useLayoutEffect, useState } from 'react';
import { Clock, MoreVertical } from 'lucide-react-native';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  spacing,
  radius,
  typography,
  states,
  SVGImageIcon,
} from '@components/design-system';
import { JewelStoreSheet } from '@components/shared/JewelStoreSheet';
import { TaskExplosionOverlay } from '@components/shared/TaskExplosionOverlay';
import { useBombCountdown } from '@hooks/useBombCountdown';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useGameTasks } from '@hooks/useGameTasks';
import { useGiftTasks } from '@hooks/useGiftTasks';
import { useWalletCounts } from '@hooks/useWalletCounts';
import * as authService from '@services/authService';
import * as gameService from '@services/gameService';
import type { GameScreenProps, AppTabOptions } from '@navigation/types';
import type { GameTask, GiftTask } from '@app-types/game';

const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');
const bombIcon = require('../../../../assets/Bomb.png');

/** How close (px) to the bottom of the scroll content before the next gift-task page is requested. */
const LOAD_MORE_THRESHOLD = 300;

export function GameScreen({ navigation }: GameScreenProps) {
  const styles = useStyles(makeStyles);
  const wallet = useWalletCounts();
  const pointTasks = useGameTasks();
  const { giftTasks, hasMore } = useGiftTasks();
  const gamebar = useGamebarStats();
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);
  const [explosionVisible, setExplosionVisible] = useState(false);
  const handleBombExploded = useCallback(() => setExplosionVisible(true), []);
  const handleExplosionDismiss = () => {
    setExplosionVisible(false);
    void authService.refreshAfterBombExplosion();
  };

  // Refetch page 0 on every focus, not just mount — remaining stock changes
  // as gifts are redeemed (including by this user on GiftTaskDetail).
  useFocusEffect(
    useCallback(() => {
      void gameService.refreshGiftTasks();
    }, []),
  );

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!hasMore) return;
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - LOAD_MORE_THRESHOLD) {
      void gameService.loadMoreGiftTasks();
    }
  };

  useLayoutEffect(() => {
    const options: AppTabOptions = {
      title: 'Game',
      headerProps: {
        actions: [
          { key: 'crates', label: `${wallet.diamonds} crates`, image: crateIcon, onPress: () => setJewelStoreVisible(true) },
          { key: 'gems', label: `${wallet.coins} gems`, image: gemIcon, onPress: () => navigation.navigate('Factory') },
          { key: 'more', label: 'Game options', icon: MoreVertical },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, wallet, gamebar]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} onScroll={handleScroll} scrollEventThrottle={200}>
        <Text style={styles.sectionTitle}>Win game points and game coins</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pointTaskRow}
          contentContainerStyle={styles.pointTaskRowContent}
        >
          {pointTasks.map((task) =>
            task.is_bomb ? (
              <BombTaskCard
                key={task.id}
                task={task}
                onPress={() => navigation.navigate('TaskDetail', { taskId: String(task.id) })}
                onExploded={handleBombExploded}
                styles={styles}
              />
            ) : (
              <Pressable
                key={task.id}
                style={({ pressed }) => [styles.pointTaskCard, pressed && { opacity: states.pressedOpacity }]}
                onPress={() => navigation.navigate('TaskDetail', { taskId: String(task.id) })}
                accessibilityRole="button"
                accessibilityLabel={`Task: ${task.points} XP, ${task.coins} coins`}
              >
                <View style={styles.pointTaskRowInner}>
                  <SVGImageIcon icon="xp" size={20} />
                  <Text style={styles.pointTaskValue}>{task.points}</Text>
                </View>
                <View style={styles.pointTaskRowInner}>
                  <SVGImageIcon icon="coin" size={20} />
                  <Text style={styles.pointTaskValue}>{task.coins}</Text>
                </View>
              </Pressable>
            ),
          )}
        </ScrollView>

        <Text style={[styles.sectionTitle, styles.giftSectionTitle]}>Win gifts</Text>
        <View style={styles.giftList}>
          {giftTasks.map((task) => (
            <GiftCard
              key={task.id}
              task={task}
              onPress={() => navigation.navigate('GiftTaskDetail', { giftTaskId: String(task.id) })}
              styles={styles}
            />
          ))}
        </View>
      </ScrollView>

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
      <TaskExplosionOverlay visible={explosionVisible} onDismiss={handleExplosionDismiss} />
    </SafeAreaView>
  );
}

/** One gift-task card: the product pic and name, both straight from /getGiftTasks. */
function GiftCard({
  task,
  onPress,
  styles,
}: {
  task: GiftTask;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.giftCard, pressed && { opacity: states.pressedOpacity }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Gift: ${task.productname}`}
    >
      <View style={styles.giftImage}>
        <ExpoImage source={{ uri: task.product_pic }} style={styles.giftPic} contentFit="contain" />
      </View>
      <Text style={styles.giftTitle} numberOfLines={2}>
        {task.productname}
      </Text>
    </Pressable>
  );
}

/** A `task.is_bomb` card: bomb art + a countdown ticker with a clock icon. */
function BombTaskCard({
  task,
  onPress,
  onExploded,
  styles,
}: {
  task: GameTask;
  onPress: () => void;
  onExploded: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const colors = useThemeColors();
  // Primitive deps (not the whole `task` object) so this stays stable
  // across tasksReceived re-fetches that don't actually change this task's
  // identity — an unstable onExpire would re-run useBombCountdown's effect
  // (re-fetch deltaGame, reset the "--:--" loading state) on every refresh.
  const handleExpire = useCallback(() => {
    void authService.explodeBomb(task.task_id, task.id).then((ok) => {
      if (ok) onExploded();
    });
  }, [task.task_id, task.id, onExploded]);
  const { display } = useBombCountdown(task.completed_at, handleExpire);

  return (
    <Pressable
      style={({ pressed }) => [styles.bombTaskCard, pressed && { opacity: states.pressedOpacity }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Bomb task: ${display} remaining`}
    >
      <Image source={bombIcon} style={styles.bombImage} resizeMode="contain" />
      <View style={styles.bombTickerRow}>
        <Clock size={12} strokeWidth={2} color={colors.error} />
        <Text style={styles.bombTickerText}>{display}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { paddingBottom: spacing.xl },
    sectionTitle: {
      ...typography.labelSm,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    giftSectionTitle: { paddingTop: spacing.lg },
    pointTaskRow: { height: 90 },
    pointTaskRowContent: { paddingLeft: spacing.md, paddingRight: spacing.sm },
    pointTaskCard: {
      width: 84,
      height: 90,
      marginRight: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'space-evenly',
    },
    pointTaskRowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    pointTaskValue: { ...typography.bodyMd, color: colors.onSurface },
    bombTaskCard: {
      width: 84,
      height: 90,
      marginRight: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1.5,
      borderColor: colors.error,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    bombImage: { width: 36, height: 36 },
    bombTickerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    bombTickerText: { ...typography.labelLg, color: colors.error, fontWeight: '700' },
    giftList: {
      paddingHorizontal: spacing.md,
      gap: spacing.md,
    },
    giftCard: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radius.md,
      overflow: 'hidden',
      paddingBottom: spacing.sm,
    },
    giftImage: {
      width: '100%',
      aspectRatio: 1.4,
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    giftPic: { width: '100%', height: '100%' },
    giftTitle: {
      ...typography.bodyMd,
      color: colors.onSurface,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
    },
  });
