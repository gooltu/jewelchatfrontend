import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Clock, MoreVertical } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import * as authService from '@services/authService';
import * as gameService from '@services/gameService';
import type { GameScreenProps, AppTabOptions } from '@navigation/types';
import type { GameTask, GiftTask } from '@app-types/game';

const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');
const bombIcon = require('../../../../assets/Bomb.png');

export function GameScreen({ navigation }: GameScreenProps) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const stats = useMemo(() => gameService.getGameStats(), []);
  const pointTasks = useGameTasks();
  const giftTasks = useMemo(() => gameService.getGiftTasks(), []);
  const gamebar = useGamebarStats();
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);
  const [explosionVisible, setExplosionVisible] = useState(false);
  const handleBombExploded = useCallback(() => setExplosionVisible(true), []);
  const handleExplosionDismiss = () => {
    setExplosionVisible(false);
    void authService.refreshAfterBombExplosion();
  };

  useLayoutEffect(() => {
    const options: AppTabOptions = {
      title: 'Game',
      headerProps: {
        actions: [
          { key: 'crates', label: `${stats.diamonds} crates`, image: crateIcon, onPress: () => setJewelStoreVisible(true) },
          { key: 'gems', label: `${stats.coins} gems`, image: gemIcon },
          { key: 'more', label: 'Game options', icon: MoreVertical },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, stats, gamebar]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
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

        <Text style={[styles.sectionTitle, styles.giftSectionTitle]}>Win cash and gifts</Text>
        <View style={styles.giftGrid}>
          {giftTasks.map((task) => (
            <GiftCard key={task.id} task={task} styles={styles} iconColor={colors.onSurfaceVariant} />
          ))}
        </View>
      </ScrollView>

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
      <TaskExplosionOverlay visible={explosionVisible} onDismiss={handleExplosionDismiss} />
    </SafeAreaView>
  );
}

function GiftCard({
  task,
  styles,
  iconColor,
}: {
  task: GiftTask;
  styles: ReturnType<typeof makeStyles>;
  iconColor: string;
}) {
  if (task.kind === 'product') {
    const Icon = task.icon;
    return (
      <View style={styles.giftCard}>
        <View style={styles.giftImage}>
          <Icon size={40} color={iconColor} strokeWidth={1.5} />
        </View>
        <Text style={styles.giftTitle} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={styles.giftQty}>{`QTY: ${task.qtyWon}/${task.qtyTotal}`}</Text>
      </View>
    );
  }

  return (
    <View style={styles.giftCard}>
      <View style={[styles.giftImage, styles.cashImage]}>
        <Text style={styles.cashSymbol}>{'₹'}</Text>
        <Text style={styles.cashAmount}>{task.amountRupees}</Text>
      </View>
      <Text style={styles.giftTitle}>{`${task.amountRupees} rupees`}</Text>
      <Text style={styles.giftQty}>{`QTY: ${task.qtyWon}/${task.qtyTotal}`}</Text>
    </View>
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
    giftGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: spacing.sm,
      gap: spacing.sm,
    },
    giftCard: {
      flexBasis: '47%',
      flexGrow: 1,
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
    cashImage: { flexDirection: 'row', gap: spacing.xs },
    cashSymbol: { ...typography.headlineMd, color: colors.onSurface },
    cashAmount: { ...typography.headlineMd, color: colors.onSurface },
    giftTitle: {
      ...typography.bodyMd,
      color: colors.onSurface,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
    },
    giftQty: {
      ...typography.labelSm,
      color: colors.onSurfaceVariant,
      paddingHorizontal: spacing.sm,
      paddingTop: 2,
    },
  });
