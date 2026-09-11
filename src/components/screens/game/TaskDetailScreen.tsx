import { useLayoutEffect, useMemo, useState } from 'react';
import { Check, Info, X } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  type SVGIconName,
  ButtonGhost,
  ButtonPrimary,
  spacing,
  radius,
  typography,
  SVGImageIcon,
} from '@components/design-system';
import { JewelStoreSheet } from '@components/shared/JewelStoreSheet';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useTaskElements } from '@hooks/useTaskElements';
import { useAppSelector } from '@store/hooks';
import * as gameService from '@services/gameService';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';

const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');

interface JewelRow {
  id: number;
  jewelIcon: SVGIconName;
  required: number;
  owned: number;
}

export function TaskDetailScreen({ route, navigation }: RootScreenProps<'TaskDetail'>) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const stats = useMemo(() => gameService.getGameStats(), []);
  const gamebar = useGamebarStats();
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);

  // route.params.taskId is the specific GameTask row's `id` (see
  // GameScreen.tsx's card onPress) — look it up in the already-fetched
  // task list rather than widening the route param.
  const taskRowId = Number(route.params.taskId);
  const task = useAppSelector((state) => state.tasks.tasks?.find((t) => t.id === taskRowId) ?? null);
  // /getTaskElements is keyed by task_id (the task "type"), not the row id.
  const elements = useTaskElements(task?.task_id ?? null);
  const jewels = useAppSelector((state) => state.game.jewels);

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: 'Task Detail',
      headerProps: {
        actions: [
          { key: 'crates', label: `${stats.diamonds} crates`, image: crateIcon, onPress: () => setJewelStoreVisible(true) },
          { key: 'gems', label: `${stats.coins} gems`, image: gemIcon },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, stats, gamebar]);

  if (!task) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Text style={styles.notFound}>Task not found.</Text>
        <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
      </SafeAreaView>
    );
  }

  if (!elements) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Text style={styles.notFound}>Loading…</Text>
        <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
      </SafeAreaView>
    );
  }

  const jewelRows: JewelRow[] = elements.map((element) => ({
    id: element.id,
    jewelIcon: `j${element.jeweltype_id}` as SVGIconName,
    required: element.count,
    owned: jewels?.find((j) => j.jeweltype_id === element.jeweltype_id)?.count ?? 0,
  }));
  const allAvailable = jewelRows.every((r) => r.owned >= r.required);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.taskCardWrap}>
          <View style={styles.taskCard}>
            <View style={styles.taskCardRow}>
              <SVGImageIcon icon="xp" size={32} />
              <Text style={styles.taskCardValue}>{task.points}</Text>
            </View>
            <View style={styles.taskCardRow}>
              <SVGImageIcon icon="coin" size={28} />
              <Text style={styles.taskCardValue}>{task.coins}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Collect jewels</Text>
        {jewelRows.map((requirement) => (
          <JewelRowItem key={requirement.id} requirement={requirement} styles={styles} colors={colors} />
        ))}

        <View style={styles.ctaWrap}>
          {allAvailable ? (
            <ButtonPrimary label="Win points & coins" />
          ) : (
            <ButtonGhost label="Collect all jewels" disabled />
          )}
        </View>
      </ScrollView>

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
    </SafeAreaView>
  );
}

function JewelRowItem({
  requirement,
  styles,
  colors,
}: {
  requirement: JewelRow;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const available = requirement.owned >= requirement.required;
  const shown = Math.min(requirement.required, 3);

  return (
    <View style={styles.jewelRow}>
      <View style={styles.jewelIcons}>
        {Array.from({ length: shown }).map((_, index) => (
          <SVGImageIcon key={index} icon={requirement.jewelIcon} size={28} />
        ))}
        {requirement.required > 5 && (
          <Text style={styles.jewelCount}>{`...(${requirement.required})`}</Text>
        )}
      </View>
      {available ? (
        <Check size={20} color={colors.success} />
      ) : (
        <View style={styles.jewelStatus}>
          <X size={20} color={colors.error} />
          <Info size={20} color={colors.onSurfaceVariant} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { paddingBottom: spacing.xl },
    notFound: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: spacing.xl },
    taskCardWrap: { alignItems: 'center', paddingVertical: spacing.xxl },
    taskCard: {
      width: 140,
      paddingVertical: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'space-evenly',
      gap: spacing.md,
    },
    taskCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    taskCardValue: { ...typography.headlineMd, color: colors.onSurface },
    sectionTitle: {
      ...typography.labelSm,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
      paddingTop: spacing.md,
    },
    jewelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    jewelIcons: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
    jewelCount: { ...typography.bodyLg, color: colors.primary },
    jewelStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    ctaWrap: { alignItems: 'center', paddingTop: spacing.xl },
  });
