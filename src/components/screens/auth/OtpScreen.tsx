import { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  spacing,
  radius,
  states,
  typography,
  ButtonPrimary,
  Toast,
} from '@components/design-system';
import * as authService from '@services/authService';
import type { AuthScreenProps } from '@navigation/types';

const CODE_LENGTH = 6;
const MAX_RESENDS = 3;

export function OtpScreen({ route, navigation }: AuthScreenProps<'Otp'>) {
  const { userId, phone, active, domain } = route.params;
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCount, setResendCount] = useState(0);
  const [resending, setResending] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const code = digits.join('');

  const handleChangeDigit = (text: string, index: number) => {
    const pasted = text.replace(/\D/g, '');
    const next = [...digits];

    if (pasted.length > 1) {
      let i = index;
      for (const char of pasted) {
        if (i >= CODE_LENGTH) break;
        next[i] = char;
        i++;
      }
      setDigits(next);
      inputRefs.current[Math.min(i, CODE_LENGTH) - 1]?.focus();
      return;
    }

    next[index] = pasted;
    setDigits(next);
    if (pasted && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (event.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendCount >= MAX_RESENDS || resending || submitting) return;
    setResending(true);
    setError(null);
    try {
      await authService.resendOtp(userId);
      setResendCount((count) => count + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await authService.verifyOtp(userId, code, { phone, domain });
      if (active) {
        await authService.completeAuth(userId);
      } else {
        navigation.navigate('ReferralNickname', { userId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Enter verification code</Text>
          <Text style={styles.subtitle}>Enter the code sent to +91 {phone}</Text>

          <View style={styles.boxRow}>
            {digits.map((digit, index) => (
              <TextInput
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                value={digit}
                onChangeText={(text) => handleChangeDigit(text, index)}
                onKeyPress={(event) => handleKeyPress(event, index)}
                keyboardType="number-pad"
                maxLength={CODE_LENGTH}
                style={styles.box}
                placeholderTextColor={colors.onSurfaceVariant}
              />
            ))}
          </View>

          <ButtonPrimary
            label={submitting ? 'Verifying…' : 'Verify'}
            onPress={handleVerify}
            disabled={code.length !== CODE_LENGTH || submitting}
          />

          {resendCount < MAX_RESENDS ? (
            <Pressable
              onPress={handleResend}
              disabled={resending || submitting}
              hitSlop={8}
              style={({ pressed }) => [
                styles.resendWrap,
                (resending || submitting) && { opacity: states.disabledOpacity },
                !(resending || submitting) && pressed && { opacity: states.pressedOpacity },
              ]}
            >
              <Text style={styles.resendLink}>
                {resending ? 'Resending…' : 'Resend code'}
              </Text>
            </Pressable>
          ) : null}

          {error ? (
            <View style={styles.toastWrap}>
              <Toast variant="error" title="Verification failed" description={error} persist />
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
    boxRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xl },
    box: {
      width: 44,
      height: 52,
      textAlign: 'center',
      borderRadius: radius.DEFAULT,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainer,
      color: colors.onSurface,
      ...typography.headlineMd,
    },
    resendWrap: { alignItems: 'center', marginTop: spacing.lg },
    resendLink: { ...typography.labelLg, color: colors.primary, textDecorationLine: 'underline' },
    toastWrap: { marginTop: spacing.lg },
  });
