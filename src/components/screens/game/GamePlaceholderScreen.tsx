import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gamepad2 } from 'lucide-react-native';
import { useStyles, type ThemeColors, Header, EmptyState } from '@components/design-system';

export function GamePlaceholderScreen() {
  const styles = useStyles(makeStyles);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Header title="Game" />
      <EmptyState icon={Gamepad2} title="Coming soon" description="Game features are on the way." />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
  });
