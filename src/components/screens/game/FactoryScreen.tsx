import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Check, Clock, X } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  type SVGIconName,
  ButtonGhost,
  ButtonPrimary,
  Toast,
  spacing,
  radius,
  typography,
  SVGImageIcon,
} from '@components/design-system';
import { JewelStoreSheet } from '@components/shared/JewelStoreSheet';
import { useFactoryCountdown } from '@hooks/useFactoryCountdown';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useJewelStoreSpaceFor } from '@hooks/useJewelStoreSpace';
import { useWalletCounts } from '@hooks/useWalletCounts';
import * as authService from '@services/authService';
import { withLoading } from '@services/loadingService';
import { useAppSelector } from '@store/hooks';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';
import { PICKABLE_JEWEL_TYPES, type FactoryDefinition, type UserFactory } from '@app-types/game';

const crateIcon = require('../../../../assets/jewelbox.png');

interface MaterialRow {
  id: number;
  jewelIcon: SVGIconName | null;
  required: number;
  owned: number;
}

const ROTATION_DURATION_MS = 4000;
/** factory.count is always 6, 3, or 1 — a fixed 3-wide grid width makes 6 wrap into two rows and 3 (or 1) sit on one, per spec. */
const JEWEL_TILE_SIZE = 64;
const JEWEL_GRID_COLUMNS = 3;

/**
 * The design-system's svgIcons set only defines `j3`-`j17` (see
 * PICKABLE_JEWEL_TYPES) plus `diamond`/`coin`/`xp`/`logo` — a jeweltype_id
 * outside that range has no icon and would crash SVGImageIcon
 * ("Element type is invalid... got undefined") if passed straight through
 * as `j${jeweltypeId}`. Resolve defensively instead of trusting the
 * backend's jeweltype_id is always in the pickable 3-17 range.
 */
function resolveJewelIcon(jeweltypeId: number): SVGIconName | null {
  if (jeweltypeId === 0) return 'diamond';
  if (jeweltypeId === 1) return 'coin';
  if ((PICKABLE_JEWEL_TYPES as readonly number[]).includes(jeweltypeId)) {
    return `j${jeweltypeId}` as SVGIconName;
  }
  if (__DEV__) console.log('[FactoryScreen] no icon for jeweltype_id', jeweltypeId);
  return null;
}

/**
 * Pushed from every tab header's "gems" action. Lists every factory from
 * game.factory.factories (the static /getFactories catalog — see
 * factorySlice.ts) as a card: main jewel on top, its required materials in
 * the middle (same owned-vs-required affordance as TaskDetailScreen's
 * "Collect jewels" section), and a Start Factory CTA at the bottom. Once
 * started (game.userFactory.userFactories — see userFactorySlice.ts), a
 * card switches to its running layout: materials hidden, jewel rotating,
 * duration counting down, and the CTA becomes Stop (POST /stopFactory) or,
 * once the countdown hits zero, "Transfer jewel to Jewel Store" (POST
 * /transferJewelsFromFactory) — see authService.ts.
 */
export function FactoryScreen({ navigation }: RootScreenProps<'Factory'>) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const gamebar = useGamebarStats();
  const factories = useAppSelector((state) => state.factory.factories);
  const materials = useAppSelector((state) => state.factory.materials);
  const jewels = useAppSelector((state) => state.game.jewels);
  const userFactories = useAppSelector((state) => state.userFactory.userFactories);
  const wallet = useWalletCounts();
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);
  const [jewelStoreFullVisible, setJewelStoreFullVisible] = useState(false);
  const handleJewelStoreFull = useCallback(() => setJewelStoreFullVisible(true), []);
  const dismissJewelStoreFull = useCallback(() => setJewelStoreFullVisible(false), []);

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: 'Factory',
      headerProps: {
        actions: [
          { key: 'crates', label: `${wallet.diamonds} crates`, image: crateIcon, onPress: () => setJewelStoreVisible(true) },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, wallet, gamebar]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {jewelStoreFullVisible && (
        <View style={styles.toastWrap}>
          <Toast
            variant="warning"
            title="Jewel store full"
            description="Free up space in your jewel store before stopping or transferring this factory."
            onDismiss={dismissJewelStoreFull}
          />
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content}>
        {!factories ? (
          <Text style={styles.notFound}>Loading…</Text>
        ) : factories.length === 0 ? (
          <Text style={styles.notFound}>No factories yet.</Text>
        ) : (
          factories.map((factory) => {
            const materialRows: MaterialRow[] = (materials ?? [])
              .filter((material) => material.factory_id === factory.factory_id)
              .map((material) => ({
                id: material.id,
                jewelIcon: resolveJewelIcon(material.jeweltype_id),
                required: material.count,
                owned: jewels?.find((j) => j.jeweltype_id === material.jeweltype_id)?.count ?? 0,
              }));
            const userFactory = userFactories?.find((uf) => uf.factory_id === factory.factory_id) ?? null;
            return (
              <FactoryCard
                key={factory.factory_id}
                factory={factory}
                materialRows={materialRows}
                userFactory={userFactory}
                onJewelStoreFull={handleJewelStoreFull}
                styles={styles}
                colors={colors}
              />
            );
          })
        )}
      </ScrollView>

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
    </SafeAreaView>
  );
}

function FactoryCard({
  factory,
  materialRows,
  userFactory,
  onJewelStoreFull,
  styles,
  colors,
}: {
  factory: FactoryDefinition;
  materialRows: MaterialRow[];
  userFactory: UserFactory | null;
  onJewelStoreFull: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const [busy, setBusy] = useState(false);
  const isOn = userFactory?.is_on === 1;
  const { display: countdownDisplay, expired } = useFactoryCountdown(
    isOn ? (userFactory?.start_time ?? null) : null,
    factory.duration,
  );
  const allAvailable = materialRows.every((row) => row.owned >= row.required);
  const mainIcon = resolveJewelIcon(factory.jeweltype_id);
  const { diamonds: ownedDiamonds } = useWalletCounts();
  const canStop = ownedDiamonds >= factory.diamond;
  // Stopping early or transferring both hand the factory's full output
  // (factory.count jewels of factory.jeweltype_id) to the jewel store —
  // pre-flight check client-side (matches useCanPickJewel's chat-jewel-pick
  // gate) so an over-capacity tap never even reaches the backend, which
  // would reject it anyway.
  const producesPickableJewel = (PICKABLE_JEWEL_TYPES as readonly number[]).includes(factory.jeweltype_id);
  const hasSpaceForOutput = useJewelStoreSpaceFor(producesPickableJewel ? factory.count : 0);
  // Once the countdown hits zero, the jewels stop spinning and sit static
  // again (same as before the factory was ever started) even though the
  // card stays in its running layout (materials hidden, Transfer CTA) until
  // the user actually transfers.
  const spinning = isOn && !expired;

  // Runs once per spinning transition, not every render — this card
  // re-renders every second while running (useFactoryCountdown's tick), and
  // restarting a withRepeat animation on every tick would make it stutter
  // instead of spinning smoothly.
  const rotation = useSharedValue(0);
  useEffect(() => {
    if (spinning) {
      rotation.value = withRepeat(withTiming(360, { duration: ROTATION_DURATION_MS, easing: Easing.linear }), -1);
    } else {
      // Explicitly cancel the running infinite withRepeat before snapping
      // back to 0 — a plain assignment alone left the tiles visually stuck
      // at whatever angle they were mid-spin, instead of resetting to their
      // original (unrotated) position, once the factory stopped.
      cancelAnimation(rotation);
      rotation.value = 0;
    }
  }, [spinning, rotation]);
  const rotationStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  const durationLabel = isOn ? countdownDisplay : `${Math.round(factory.duration / 60)} min`;

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await withLoading(() => authService.startFactory(factory.factory_id), 'Starting factory…');
      if (!ok && __DEV__) console.log('[FactoryScreen] startFactory failed', factory.factory_id);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (busy) return;
    if (!hasSpaceForOutput) {
      onJewelStoreFull();
      return;
    }
    setBusy(true);
    try {
      const ok = await withLoading(() => authService.stopFactory(factory.factory_id), 'Stopping factory…');
      if (!ok && __DEV__) console.log('[FactoryScreen] stopFactory failed', factory.factory_id);
    } finally {
      setBusy(false);
    }
  };

  const handleTransfer = async () => {
    if (busy) return;
    if (!hasSpaceForOutput) {
      onJewelStoreFull();
      return;
    }
    setBusy(true);
    try {
      const ok = await withLoading(
        () => authService.transferJewelsFromFactory(factory.factory_id),
        'Transferring jewels…',
      );
      if (!ok && __DEV__) console.log('[FactoryScreen] transferJewelsFromFactory failed', factory.factory_id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.jewelWrap}>
        <View style={styles.jewelGrid}>
          {mainIcon &&
            Array.from({ length: factory.count }).map((_, index) => (
              // Each tile gets its own Animated.View (sharing one rotation
              // driver) so every jewel spins in place individually, rather
              // than the whole count*count block rotating as one rigid
              // unit around a shared center. Style is always bound (not
              // conditionally undefined) so rotation.value is the single
              // source of truth for the tile's angle at every point,
              // including the reset to 0 once spinning stops.
              <Animated.View key={index} style={rotationStyle}>
                <SVGImageIcon icon={mainIcon} size={JEWEL_TILE_SIZE} tile />
              </Animated.View>
            ))}
        </View>
      </View>

      {!isOn && (
        <>
          <View style={styles.materialsDivider} />
          {materialRows.map((row) => (
            <MaterialRowItem key={row.id} row={row} styles={styles} colors={colors} />
          ))}
        </>
      )}

      <View style={styles.durationRow}>
        <Clock size={16} strokeWidth={2} color={colors.onSurfaceVariant} />
        <Text style={styles.durationText}>{durationLabel}</Text>
      </View>

      <View style={styles.ctaWrap}>
        {!isOn ? (
          allAvailable ? (
            <ButtonPrimary label="Start Factory" onPress={() => void handleStart()} disabled={busy} />
          ) : (
            <ButtonGhost label="Collect jewels to start factory" disabled />
          )
        ) : expired ? (
          <ButtonPrimary
            label="Transfer jewel to Jewel Store"
            onPress={() => void handleTransfer()}
            disabled={busy}
          />
        ) : (
          <>
            <View style={styles.stopCostRow}>
              <SVGImageIcon icon="diamond" size={20} />
              <Text style={styles.jewelCount}>{`x${factory.diamond}`}</Text>
            </View>
            {canStop ? (
              <ButtonPrimary label="Stop" onPress={() => void handleStop()} disabled={busy} />
            ) : (
              <ButtonGhost label="Stop" disabled />
            )}
          </>
        )}
      </View>
    </View>
  );
}

function MaterialRowItem({
  row,
  styles,
  colors,
}: {
  row: MaterialRow;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const available = row.owned >= row.required;

  return (
    <View style={styles.jewelRow}>
      <View style={styles.jewelIcons}>
        {row.jewelIcon && <SVGImageIcon icon={row.jewelIcon} size={28} />}
        <Text style={styles.jewelCount}>{`x${row.required}`}</Text>
      </View>
      {available ? <Check size={20} color={colors.success} /> : <X size={20} color={colors.error} />}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { paddingBottom: spacing.xl },
    // Floats over the scrollable card list instead of sitting in-flow above
    // it, so showing/dismissing it never shifts the cards underneath.
    toastWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    notFound: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: spacing.xl },
    card: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
      overflow: 'hidden',
      paddingBottom: spacing.lg,
    },
    jewelWrap: { alignItems: 'center', paddingVertical: spacing.xl },
    jewelGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: spacing.sm,
      rowGap: spacing.sm,
      width: JEWEL_TILE_SIZE * JEWEL_GRID_COLUMNS + spacing.sm * (JEWEL_GRID_COLUMNS - 1),
    },
    materialsDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
      marginHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    jewelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    jewelIcons: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
    jewelCount: { ...typography.bodyLg, color: colors.primary },
    durationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingTop: spacing.sm,
    },
    durationText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    stopCostRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingBottom: spacing.sm,
    },
    ctaWrap: { alignItems: 'center', paddingTop: spacing.lg, paddingHorizontal: spacing.md },
  });
