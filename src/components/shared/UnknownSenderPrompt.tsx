import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  ButtonGhost,
  ButtonPrimary,
  useStyles,
  subTestID,
  type ThemeColors,
  radius,
  spacing,
  typography,
} from '@components/design-system';
import { useAvatarSource } from '@hooks/useAvatarSource';
import { formatPhoneNumber } from '../../utils/contactDisplay';
import { initialsFor } from '../../utils/initials';
import type { Contact } from '@app-types/chat';

interface UnknownSenderPromptProps {
  contact: Contact;
  /** Disables the buttons while an answer is being saved. */
  busy?: boolean;
  onAdd: () => void;
  onBlock: () => void;
  onContinue: () => void;
  /** Root id; children get `.phone`, `.add`, `.block`, `.continue`. */
  testID?: string;
}

/**
 * Shown in ChatDetailScreen in place of the composer for a 1:1 chat from
 * someone not in the phonebook, until the user picks Add to contacts, Block
 * or Continue (see services/unknownSenderService.ts). App-local, built only
 * from design-system primitives, like MessageActionSheet.
 */
export function UnknownSenderPrompt({
  contact,
  busy = false,
  onAdd,
  onBlock,
  onContinue,
  testID,
}: UnknownSenderPromptProps) {
  const styles = useStyles(makeStyles);
  const avatarSource = useAvatarSource(contact.JID);
  const phone = formatPhoneNumber(contact.CONTACT_NUMBER);

  const confirmBlock = () => {
    Alert.alert(
      `Block ${phone ?? 'this person'}?`,
      "You won't get their messages on this device. They won't be told.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: onBlock },
      ],
    );
  };

  return (
    <View testID={testID} style={styles.container}>
      <View style={styles.identity}>
        <Avatar source={avatarSource} initials={initialsFor(phone ?? undefined)} size={48} />
        <View style={styles.identityText}>
          <Text testID={subTestID(testID, 'phone')} style={styles.phone}>
            {phone ?? 'Looking up number…'}
          </Text>
          <Text style={styles.caption}>Not in your contacts</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <ButtonGhost
            testID={subTestID(testID, 'block')}
            label="Block"
            onPress={confirmBlock}
            disabled={busy}
          />
        </View>
        <View style={styles.action}>
          <ButtonGhost
            testID={subTestID(testID, 'add')}
            label="Add to contacts"
            onPress={onAdd}
            disabled={busy || !phone}
          />
        </View>
      </View>
      <ButtonPrimary
        testID={subTestID(testID, 'continue')}
        label="Continue"
        onPress={onContinue}
        disabled={busy}
      />
    </View>
  );
}

interface BlockedBannerProps {
  busy?: boolean;
  onUnblock: () => void;
  /** Root id; the button gets `.unblock`. */
  testID?: string;
}

/** Replaces the composer in a chat the user has blocked. */
export function BlockedBanner({ busy = false, onUnblock, testID }: BlockedBannerProps) {
  const styles = useStyles(makeStyles);
  return (
    <View testID={testID} style={[styles.container, styles.blockedRow]}>
      <Text style={[styles.caption, styles.blockedText]}>You blocked this contact</Text>
      <ButtonGhost
        testID={subTestID(testID, 'unblock')}
        label="Unblock"
        onPress={onUnblock}
        disabled={busy}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginHorizontal: spacing.gutterChat,
      marginBottom: spacing.sm,
      padding: spacing.md,
      gap: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surfaceContainerHigh,
    },
    identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    identityText: { flex: 1, gap: spacing.xs },
    phone: { ...typography.bodyMd, color: colors.onSurface },
    caption: { ...typography.labelSm, color: colors.onSurfaceVariant },
    actions: { flexDirection: 'row', gap: spacing.sm },
    action: { flex: 1 },
    blockedRow: { flexDirection: 'row', alignItems: 'center' },
    blockedText: { flex: 1 },
  });
