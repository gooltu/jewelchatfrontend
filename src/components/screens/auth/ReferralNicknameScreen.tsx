import { useState } from 'react';
import { StyleSheet, View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  radius,
  typography,
  InputField,
  ButtonPrimary,
  ButtonGhost,
  Toast,
} from '@components/design-system';
import * as authService from '@services/authService';
import type { AuthScreenProps } from '@navigation/types';

export function ReferralNicknameScreen({ route }: AuthScreenProps<'ReferralNickname'>) {
  const { userId } = route.params;
  const styles = useStyles(makeStyles);
  const [referrerPhone, setReferrerPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSkip = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await authService.completeAuth(userId);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!referrerPhone && !nickname) {
      await handleSkip();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authService.submitInitialDetails(userId, referrerPhone, nickname);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your details. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Almost there</Text>
          <Text style={styles.subtitle}>Tell us a bit more about you — this is optional.</Text>

          <View style={[styles.row, styles.field]}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+91</Text>
            </View>
            <View style={styles.inputWrap}>
              <InputField
                placeholder="Referrer's phone number"
                keyboardType="number-pad"
                maxLength={10}
                value={referrerPhone}
                onChangeText={(text) => setReferrerPhone(text.replace(/\D/g, ''))}
              />
            </View>
          </View>
          <View style={styles.field}>
            <InputField
              placeholder="Your nickname"
              autoCapitalize="words"
              value={nickname}
              onChangeText={setNickname}
            />
          </View>

          <ButtonPrimary label="Continue" onPress={handleSubmit} disabled={submitting} />

          <View style={styles.skip}>
            <ButtonGhost label="Skip" onPress={handleSkip} />
          </View>

          {error ? (
            <View style={styles.toastWrap}>
              <Toast variant="error" title="Could not continue" description={error} persist />
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
    row: { flexDirection: 'row', alignItems: 'center' },
    prefix: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radius.DEFAULT,
      paddingHorizontal: spacing.md,
      height: 44,
      justifyContent: 'center',
    },
    prefixText: { ...typography.bodyLg, color: colors.onSurface },
    inputWrap: { flex: 1, marginLeft: spacing.sm },
    skip: { marginTop: spacing.md },
    toastWrap: { marginTop: spacing.lg },
  });
