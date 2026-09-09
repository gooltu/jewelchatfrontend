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
  Toast,
} from '@components/design-system';
import * as authService from '@services/authService';
import type { AuthScreenProps } from '@navigation/types';

export function PhoneEntryScreen({ navigation }: AuthScreenProps<'PhoneEntry'>) {
  const styles = useStyles(makeStyles);
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = async () => {
    if (phone.length !== 10 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { userId, active, domain } = await authService.requestOtp(phone);
      navigation.navigate('Otp', { userId, phone, active, domain });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a verification code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Enter your phone number</Text>
          <Text style={styles.subtitle}>We will send you a verification code</Text>

          <View style={styles.row}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+91</Text>
            </View>
            <View style={styles.inputWrap}>
              <InputField
                keyboardType="number-pad"
                maxLength={10}
                value={phone}
                onChangeText={(text) => setPhone(text.replace(/\D/g, ''))}
              />
            </View>
          </View>

          <ButtonPrimary
            label={submitting ? 'Sending…' : 'Next'}
            onPress={handleNext}
            disabled={phone.length !== 10 || submitting}
          />

          {error ? (
            <View style={styles.toastWrap}>
              <Toast variant="error" title="Could not send code" description={error} persist />
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
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    prefix: {
      backgroundColor: colors.surfaceContainer,
      borderRadius: radius.DEFAULT,
      paddingHorizontal: spacing.md,
      height: 44,
      justifyContent: 'center',
    },
    prefixText: { ...typography.bodyLg, color: colors.onSurface },
    inputWrap: { flex: 1, marginLeft: spacing.sm },
    toastWrap: { marginTop: spacing.lg },
  });
