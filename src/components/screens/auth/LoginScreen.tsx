import { useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  typography,
  InputField,
  ButtonPrimary,
  Toast,
} from '@components/design-system';
import * as authService from '@services/authService';

export function LoginScreen() {
  const styles = useStyles(makeStyles);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!username || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authService.login(username, password);
    } catch {
      setError('Could not sign in. Check your username and password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.title}>JewelChat</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <InputField
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          style={styles.field}
        />
        <InputField
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.field}
        />

        <ButtonPrimary
          label={submitting ? 'Signing in…' : 'Sign in'}
          onPress={handleSubmit}
          disabled={submitting || !username || !password}
        />

        {error ? (
          <View style={styles.toastWrap}>
            <Toast variant="error" title="Sign in failed" description={error} persist />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
    title: { ...typography.headlineLg, color: colors.onSurface, marginBottom: spacing.xs },
    subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginBottom: spacing.xl },
    field: { marginBottom: spacing.md },
    toastWrap: { marginTop: spacing.lg },
  });
