import { StyleSheet, Text } from 'react-native';
import { useStyles, type ThemeColors, spacing, typography } from '@components/design-system';
import { openLegalLink } from '../../utils/legalLinks';

/**
 * "By continuing you agree to…" line shown where the account gets created
 * (PhoneEntryScreen). Both links open the ServerProjextX-hosted pages.
 */
export function LegalConsentText({ testID }: { testID?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <Text style={styles.text} testID={testID}>
      By continuing, you agree to our{' '}
      <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink('terms')}>
        Terms of Service
      </Text>{' '}
      and{' '}
      <Text style={styles.link} accessibilityRole="link" onPress={() => openLegalLink('privacy')}>
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    text: { ...typography.labelSm, color: colors.onSurfaceVariant, textAlign: 'center', marginTop: spacing.lg },
    link: { color: colors.primary, textDecorationLine: 'underline' },
  });
