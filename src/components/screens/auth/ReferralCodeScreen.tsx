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

const PHONE_LENGTH = 10;

/**
 * Optional referrer step — first-time users only, after ProfileName. The name
 * is already saved; it's carried here because /initialDetails overwrites it.
 */
export function ReferralCodeScreen({ route }: AuthScreenProps<'ReferralCode'>) {
  const { userId, name } = route.params;
  const styles = useStyles(makeStyles);
  const [referrerPhone, setReferrerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneIncomplete = referrerPhone.length > 0 && referrerPhone.length !== PHONE_LENGTH;

  const handleSkip = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authService.completeAuth(userId, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not continue. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting || phoneIncomplete) return;
    if (!referrerPhone) {
      await handleSkip();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authService.submitReference(userId, referrerPhone, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the reference number. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Were you referred?</Text>
          <Text style={styles.subtitle}>
            Enter the phone number of the friend who invited you — this is optional.
          </Text>

          <View style={[styles.row, styles.field]}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+91</Text>
            </View>
            <View style={styles.inputWrap}>
              <InputField
                testID="referral.referrer-phone"
                placeholder="Referrer's phone number"
                keyboardType="number-pad"
                maxLength={PHONE_LENGTH}
                value={referrerPhone}
                onChangeText={(text) => setReferrerPhone(text.replace(/\D/g, ''))}
              />
            </View>
          </View>
          <ButtonPrimary
            testID="referral.continue"
            label="Continue"
            onPress={handleSubmit}
            disabled={submitting || phoneIncomplete}
          />

          <View style={styles.skip}>
            <ButtonGhost testID="referral.skip" label="Skip" onPress={handleSkip} disabled={submitting} />
          </View>

          {error ? (
            <View style={styles.toastWrap}>
              <Toast
                testID="referral.error"
                variant="error"
                title="Could not continue" description={error} persist />
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
