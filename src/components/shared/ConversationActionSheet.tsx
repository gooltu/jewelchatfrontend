import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pin, PinOff, Archive, ArchiveRestore, Trash2 } from 'lucide-react-native';
import { useStyles, type ThemeColors, radius, spacing, typography } from '@components/design-system';
import * as chatService from '@services/chatService';
import type { Conversation } from '@app-types/chat';

interface ConversationActionSheetProps {
  visible: boolean;
  conversation: Conversation | null;
  onClose: () => void;
}

/**
 * Long-press menu for a single conversation row (ChatListScreen), or the
 * currently-open conversation's header "more" action (ChatDetailScreen) —
 * same Modal pattern as MessageActionSheet/JewelStoreSheet. Pin/Unpin,
 * Archive/Unarchive, Delete conversation.
 */
export function ConversationActionSheet({ visible, conversation, onClose }: ConversationActionSheetProps) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  if (!conversation?.JID) return null;
  const jid = conversation.JID;

  const handleTogglePin = async () => {
    await chatService.setConversationPinned(jid, !conversation.IS_PINNED);
    onClose();
  };

  const handleToggleArchive = async () => {
    await chatService.setConversationArchived(jid, !conversation.IS_ARCHIVED);
    onClose();
  };

  const handleDelete = () => {
    onClose();
    Alert.alert('Delete conversation?', 'This clears the chat history for you only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void chatService.deleteConversation(jid),
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <ActionRow
          icon={conversation.IS_PINNED ? PinOff : Pin}
          label={conversation.IS_PINNED ? 'Unpin' : 'Pin'}
          onPress={() => void handleTogglePin()}
        />
        <ActionRow
          icon={conversation.IS_ARCHIVED ? ArchiveRestore : Archive}
          label={conversation.IS_ARCHIVED ? 'Unarchive' : 'Archive'}
          onPress={() => void handleToggleArchive()}
        />
        <ActionRow icon={Trash2} label="Delete conversation" destructive onPress={handleDelete} />
      </View>
    </Modal>
  );
}

function ActionRow({
  icon: Icon,
  label,
  destructive,
  onPress,
}: {
  icon: typeof Pin;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Icon size={20} color={destructive ? styles.destructiveColor.color : styles.rowIcon.color} />
      <Text style={[typography.bodyMd, styles.rowLabel, destructive && styles.destructiveColor]}>
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.backdrop },
    sheet: {
      backgroundColor: colors.surfaceContainerHigh,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.outline,
      marginVertical: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowIcon: { color: colors.onSurface },
    rowLabel: { color: colors.onSurface },
    destructiveColor: { color: colors.error },
  });
