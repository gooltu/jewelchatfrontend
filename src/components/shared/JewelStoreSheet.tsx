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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <Image source={crateIcon} style={styles.crateImage} resizeMode="contain" />
        <Text style={[typography.headlineMd, styles.title]}>Jewel Store</Text>
        <View style={styles.grid}>
          {jewels.map((jewel) => (
            <View key={jewel.type} style={styles.cell}>
              {jewel.count > 0 ? (
                <>
                  <SVGImageIcon icon={jewel.icon} size={40} tile />
                  <Text style={[typography.labelLg, styles.count]}>
                    {String(jewel.count).padStart(2, '0')}
                  </Text>
                </>
              ) : (
                <View style={styles.emptyTile} />
              )}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const CELL_TILE_SIZE = 56;

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
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      gap: spacing.md,
      width: '100%',
      paddingBottom: spacing.md,
    },
    cell: {
      flexBasis: '28%',
      alignItems: 'center',
      gap: spacing.xs,
    },
    count: {
      color: colors.onSurfaceVariant,
    },
    emptyTile: {
      width: CELL_TILE_SIZE,
      height: CELL_TILE_SIZE,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceContainerHighest,
    },
  });
