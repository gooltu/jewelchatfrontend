import { useLayoutEffect, useMemo, useState } from 'react';
import { Gift, MoreVertical, Share2, Trophy, Wallet } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  ButtonGhost,
  ButtonPrimary,
  Avatar,
  ProgressBar,
  SVGImageIcon,
  spacing,
  radius,
  typography,
} from '@components/design-system';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { setThemeMode, type ThemeMode } from '@store/slices/themeSlice';
import { JewelStoreSheet } from '@components/shared/JewelStoreSheet';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useWalletCounts } from '@hooks/useWalletCounts';
import * as authService from '@services/authService';
import * as gameService from '@services/gameService';
import type { TabScreenProps, AppTabOptions } from '@navigation/types';
import type { DiamondChecklistItem } from '@app-types/game';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');

const QUICK_ACTIONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'wallet', label: 'Wallet', icon: Wallet },
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'gifts', label: 'Gifts Won', icon: Gift },
  { key: 'referrals', label: 'Referrals', icon: Share2 },
];

function initialsFor(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function SettingsScreen({ navigation }: TabScreenProps<'ProfileTab'>) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const dispatch = useAppDispatch();
  const currentMode = useAppSelector((state) => state.theme.mode);
  const displayName = useAppSelector((state) => state.auth.displayName);
  const connectionStatus = useAppSelector((state) => state.chat.connectionStatus);

  const checklist = useMemo(() => gameService.getDiamondChecklist(), []);
  const username = displayName ?? gameService.getProfileSummary().username;
  const gamebar = useGamebarStats();
  const wallet = useWalletCounts();
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);

  useLayoutEffect(() => {
    const options: AppTabOptions = {
      title: 'Profile',
      headerProps: {
        actions: [
          { key: 'crates', label: `${wallet.diamonds} crates`, image: crateIcon, onPress: () => setJewelStoreVisible(true) },
          { key: 'gems', label: `${wallet.coins} gems`, image: gemIcon },
          { key: 'more', label: 'Profile options', icon: MoreVertical },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, wallet, gamebar]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statRow}>
          <View style={styles.statPill}>
            <SVGImageIcon icon="diamond" size={22} />
            <Text style={styles.statValue}>{wallet.diamonds}</Text>
          </View>
          <View style={styles.identity}>
            <Avatar initials={initialsFor(username)} size={72} />
            <Text style={styles.username}>{username}</Text>
          </View>
          <View style={styles.statPill}>
            <SVGImageIcon icon="coin" size={22} />
            <Text style={styles.statValue}>{wallet.coins}</Text>
          </View>
        </View>

        <View style={styles.quickActionRow}>
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <View key={action.key} style={styles.quickActionTile}>
                <Icon size={22} color={colors.onPrimaryContainer} strokeWidth={2} />
                <Text style={styles.quickActionLabel}>{action.label}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Win game diamonds</Text>
        {checklist.map((item) => (
          <ChecklistRow key={item.id} item={item} styles={styles} />
        ))}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View style={styles.row}>
            {THEME_MODES.map((mode) => (
              <View key={mode} style={styles.modeButton}>
                <ButtonGhost
                  label={mode[0].toUpperCase() + mode.slice(1)}
                  onPress={() => dispatch(setThemeMode(mode))}
                  disabled={currentMode === mode}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Chat connection</Text>
          <Text style={styles.value}>{connectionStatus}</Text>
        </View>

        <View style={styles.section}>
          <ButtonPrimary label="Sign out" onPress={() => void authService.logout()} />
        </View>
      </ScrollView>

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
    </SafeAreaView>
  );
}

function ChecklistRow({ item, styles }: { item: DiamondChecklistItem; styles: ReturnType<typeof makeStyles> }) {
  const complete = item.progress >= 1;
  return (
    <View style={styles.checklistRow}>
      <View style={styles.checklistProgress}>
        <View style={styles.checklistTextRow}>
          <Text style={styles.checklistText}>{item.text}</Text>
          {item.jewelIcon && <SVGImageIcon icon={item.jewelIcon} size={20} />}
        </View>
        <ProgressBar progress={item.progress} />
      </View>
      <View style={styles.checklistReward}>
        {item.reward.kind === 'diamonds' ? (
          <>
            <View style={styles.checklistDiamond}>
              <Text style={styles.checklistDiamondValue}>{item.reward.amount}</Text>
              <SVGImageIcon icon="diamond" size={16} />
            </View>
            <ButtonGhost label="Win" disabled={!complete} />
          </>
        ) : (
          <ButtonGhost label={`Level ${item.reward.required}`} disabled />
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { paddingBottom: spacing.xl },
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-evenly',
      paddingVertical: spacing.lg,
    },
    statPill: { alignItems: 'center', gap: spacing.xs },
    statValue: { ...typography.bodyLg, color: colors.onSurface },
    identity: { alignItems: 'center', gap: spacing.sm },
    username: { ...typography.bodyMd, color: colors.onSurface },
    quickActionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    quickActionTile: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.primaryContainer,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
    },
    quickActionLabel: { ...typography.labelSm, color: colors.onPrimaryContainer },
    sectionTitle: {
      ...typography.labelSm,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    checklistRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
    },
    checklistProgress: { flex: 1, gap: spacing.xs },
    checklistTextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    checklistText: { ...typography.bodyMd, color: colors.onSurface, flexShrink: 1 },
    checklistReward: { alignItems: 'center', gap: spacing.xs },
    checklistDiamond: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    checklistDiamondValue: { ...typography.bodyMd, color: colors.onSurface },
    section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    row: { flexDirection: 'row', gap: spacing.sm },
    modeButton: { flex: 1 },
    value: { ...typography.bodyMd, color: colors.onSurface },
  });
