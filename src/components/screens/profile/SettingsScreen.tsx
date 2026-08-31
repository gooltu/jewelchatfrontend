import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  Header,
  ButtonGhost,
  ButtonPrimary,
  spacing,
  typography,
} from '@components/design-system';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { setThemeMode, type ThemeMode } from '@store/slices/themeSlice';
import * as authService from '@services/authService';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];

export function SettingsScreen() {
  const styles = useStyles(makeStyles);
  const dispatch = useAppDispatch();
  const currentMode = useAppSelector((state) => state.theme.mode);
  const displayName = useAppSelector((state) => state.auth.displayName);
  const connectionStatus = useAppSelector((state) => state.chat.connectionStatus);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Header title="Settings" subtitle={displayName ?? undefined} />

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
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    sectionTitle: { ...typography.labelLg, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.sm },
    modeButton: { flex: 1 },
    value: { ...typography.bodyMd, color: colors.onSurface },
  });
