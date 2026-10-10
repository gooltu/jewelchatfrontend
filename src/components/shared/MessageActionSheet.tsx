import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Reply, Forward, Copy, Star, Trash2 } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useStyles, type ThemeColors, radius, spacing, typography } from '@components/design-system';
import * as chatService from '@services/chatService';
import { MSG_TYPE, type ChatMessage } from '@app-types/chat';

interface MessageActionSheetProps {
  visible: boolean;
  message: ChatMessage | null;
  onClose: () => void;
  onReply: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
}

/**
 * Long-press menu for a single message — Modal-based, same pattern as
 * JewelStoreSheet.tsx. Never opened for MSG_TYPE.SYSTEM rows (those never
 * render as a MessageBubble in the first place, so onLongPress can't fire on
 * one), so no guard is needed here beyond `message` being non-null.
 */
export function MessageActionSheet({ visible, message, onClose, onReply, onForward }: MessageActionSheetProps) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  if (!message) return null;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(message.MSG_TEXT ?? '');
    onClose();
  };

  const handleToggleStar = async () => {
    await chatService.toggleMessageStar(message);
    onClose();
  };

  const handleDelete = () => {
    onClose();
    Alert.alert('Delete message?', 'This only deletes it for you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void chatService.deleteMessageForMe(message),
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <ActionRow icon={Reply} label="Reply" onPress={() => onReply(message)} />
        <ActionRow icon={Forward} label="Forward" onPress={() => onForward(message)} />
        {message.MSG_TYPE === MSG_TYPE.TEXT ? (
          <ActionRow icon={Copy} label="Copy" onPress={() => void handleCopy()} />
        ) : null}
        <ActionRow
          icon={Star}
          label={message.IS_STARRED ? 'Unstar' : 'Star'}
          onPress={() => void handleToggleStar()}
        />
        <ActionRow icon={Trash2} label="Delete" destructive onPress={handleDelete} />
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
  icon: typeof Reply;
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
