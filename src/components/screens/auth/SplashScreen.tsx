import { useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useStyles, type ThemeColors, spacing, typography, SVGImageIcon } from '@components/design-system';
import type { AuthScreenProps } from '@navigation/types';

const AUTO_ADVANCE_DELAY_MS = 1500;

/**
 * Dual-purpose: rendered directly by AppNavigator (no props) while auth status
 * is 'initializing', and as AuthNavigator's first route (with nav props),
 * where it auto-advances to Onboarding after a brief delay.
 */
export function SplashScreen({ navigation }: Partial<AuthScreenProps<'Splash'>> = {}) {
  const styles = useStyles(makeStyles);

  useEffect(() => {
    if (!navigation) return;
    const timer = setTimeout(() => navigation.replace('Onboarding'), AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <SVGImageIcon icon="logo" size={180} />
      <Text style={styles.title}>JewelChat</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    title: { ...typography.headlineLg, color: colors.onSurface, marginTop: spacing.lg },
  });
