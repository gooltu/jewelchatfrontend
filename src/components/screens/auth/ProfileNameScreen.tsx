import { useState } from 'react';
import { StyleSheet, View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
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
import type { AuthScreenProps } from '@navigation/types';

const MAX_NAME_LENGTH = 50;

/**
 * Mandatory name step after OTP. Shown to first-time users (who then go on to
 * the optional ReferralCode step) and to returning users whose server-side
 * name is blank (who go straight in).
 */
export function ProfileNameScreen({ route, navigation }: AuthScreenProps<'ProfileName'>) {
  const { userId, isNewUser, initialName } = route.params;
  const styles = useStyles(makeStyles);
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  const handleContinue = async () => {
    if (submitting || !trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await authService.saveProfileName(trimmed);
      if (isNewUser) {
        navigation.navigate('ReferralCode', { userId, name: trimmed });
        setSubmitting(false);
      } else {
        await authService.completeAuth(userId, trimmed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>What&apos;s your name?</Text>
          <Text style={styles.subtitle}>This is how you&apos;ll appear to your friends.</Text>

          <View style={styles.field}>
            <InputField
              testID="profile-name.name"
              placeholder="Your name"
              autoCapitalize="words"
              autoFocus
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChangeText={setName}
              onSubmitEditing={handleContinue}
            />
          </View>

          <ButtonPrimary
            testID="profile-name.continue"
            label="Continue"
            onPress={handleContinue}
            disabled={submitting || !trimmed}
          />

          {error ? (
            <View style={styles.toastWrap}>
              <Toast
                testID="profile-name.error"
                variant="error"
                title="Could not continue"
                description={error}
                persist
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    flex: { flex: 1 },
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
    title: { ...typography.headlineLg, color: colors.onSurface, marginBottom: spacing.xs },
    subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginBottom: spacing.xl },
    field: { marginBottom: spacing.md },
    toastWrap: { marginTop: spacing.lg },
  });
