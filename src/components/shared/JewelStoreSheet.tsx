import { useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  radius,
  spacing,
  typography,
  SVGImageIcon,
} from '@components/design-system';
import { useJewelCounts } from '@hooks/useJewelCounts';
import * as authService from '@services/authService';
import { MAX_JEWEL_CAPACITY } from '@app-types/game';

const crateIcon = require('../../../assets/jewelbox.png');

interface JewelStoreSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Bottom sheet listing all 15 jewel counts (game.jewels[3..17]) — opened from the header's crate icon. */
export function JewelStoreSheet({ visible, onClose }: JewelStoreSheetProps) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const jewels = useJewelCounts();
  const totalCount = jewels.reduce((sum, jewel) => sum + jewel.count, 0);
  const isFull = totalCount >= MAX_JEWEL_CAPACITY;
  // useJewelCounts() is already ascending by jeweltype_id, so filtering
  // preserves that order — only owned types are shown, left-to-right.
  const ownedJewels = jewels.filter((jewel) => jewel.count > 0);

  // On open: flush any jewels picked in chat but not yet synced (a no-op if
  // game.pickedJewels is empty), then refresh game.jewels/game.scores
  // unconditionally either way — not just on a successful flush — so the
  // grid always reflects the latest server state.
  useEffect(() => {
    if (!visible) return;
    void authService.flushPickedJewels().then(() => authService.refreshGameState());
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <Image source={crateIcon} style={styles.crateImage} resizeMode="contain" />
        <Text style={[typography.headlineMd, styles.title, isFull && styles.titleFull]}>
          {`Jewel Store (${totalCount})`}
        </Text>
        {ownedJewels.length === 0 ? (
          <Text style={styles.empty}>No jewels yet.</Text>
        ) : (
          <View style={styles.grid}>
            {ownedJewels.map((jewel) => (
              <View key={jewel.type} style={styles.cell}>
                <SVGImageIcon icon={jewel.icon} size={JEWEL_TILE_SIZE} tile />
                <Text style={[typography.labelLg, styles.count]}>
                  {String(jewel.count).padStart(2, '0')}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

/** 5 columns (was 3) — icon/tile sizes shrunk to match. */
const JEWEL_TILE_SIZE = 28;

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
    },
    sheet: {
      backgroundColor: colors.surfaceContainerHigh,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.outline,
      marginVertical: spacing.sm,
    },
    crateImage: {
      width: 96,
      height: 96,
      marginTop: spacing.sm,
    },
    title: {
      color: colors.onSurface,
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
    },
    titleFull: {
      color: colors.error,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: spacing.sm,
      rowGap: spacing.lg,
      width: '100%',
      paddingBottom: spacing.md,
    },
    cell: {
      flexBasis: '16%',
      alignItems: 'center',
      gap: spacing.xs,
    },
    count: {
      color: colors.onSurfaceVariant,
    },
    empty: {
      ...typography.bodyMd,
      color: colors.onSurfaceVariant,
      paddingBottom: spacing.lg,
    },
  });
