import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStyles, useThemeColors, type ThemeColors, radius, spacing, typography } from '@components/design-system';
import { useAppSelector } from '@store/hooks';

/**
 * Mounted once at the app root (App.tsx), floating above whatever screen is
 * active — see loadingService.ts for how flows opt into showing it.
 * `pointerEvents="none"` on the wrapper so it never blocks touches to the
 * screen underneath; it's a status indicator, not a blocking modal.
 */
export function FloatingLoadingPanel() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const activeCount = useAppSelector((state) => state.loading.activeCount);
  const message = useAppSelector((state) => state.loading.message);

  if (activeCount === 0) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + spacing.sm }]} pointerEvents="none">
      <View style={styles.panel}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.text}>{message ?? 'Loading…'}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      zIndex: 1000,
      elevation: 10,
    },
    panel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surfaceContainerHigh,
      borderRadius: radius.xl,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    text: { ...typography.labelLg, color: colors.onSurface },
  });
