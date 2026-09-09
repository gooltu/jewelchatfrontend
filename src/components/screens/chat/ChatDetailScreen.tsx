import { useEffect } from 'react';
import { MoreVertical, Phone } from 'lucide-react-native';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  type PickerMediaItem,
  Header,
  MessageBubble,
  ReactionPill,
  TypingIndicator,
  ChatInputBar,
  spacing,
  typography,
} from '@components/design-system';
import { useMessages } from '@hooks/useMessages';
import { useMessageReactions } from '@hooks/useMessageReactions';
import { useMediaPicker } from '@hooks/useMediaPicker';
import { useAppSelector } from '@store/hooks';
import { typingSelectors } from '@store/slices/chatSlice';
import * as chatService from '@services/chatService';
import { deriveMessageStatus } from '@database/messageRepository';
import type { RootScreenProps } from '@navigation/types';
import { MSG_TYPE, type ChatMessage } from '@app-types/chat';
import { initialsFor } from './ChatListScreen';

export function ChatDetailScreen({ route, navigation }: RootScreenProps<'ChatDetail'>) {
  const { chatRoomJid, title, isGroup } = route.params;
  const styles = useStyles(makeStyles);
  const myJid = useAppSelector((state) => state.auth.jid);
  const { messages, loading, hasMore, loadMore } = useMessages(chatRoomJid);
  const isPeerTyping = useAppSelector(
    (state) => typingSelectors.selectById(state, chatRoomJid)?.isTyping ?? false,
  );
  const stickers = useMediaPicker('stickers');
  const gifs = useMediaPicker('gifs');

  useEffect(() => {
    chatService.setActiveConversation(chatRoomJid);
    return () => chatService.setActiveConversation(null);
  }, [chatRoomJid]);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // NOTE: chatService.sendTypingIndicator exists and is fully wired on the
  // receive side (stropheEvents -> chatSlice's typing entity adapter), but
  // ChatInputBar's documented props don't expose an onChangeText/keystroke
  // seam to drive it from here — see this package's CLAUDE.md component
  // index. Wiring outgoing typing indicators needs that prop added
  // upstream in @nocturnalflow/design-system, the same way onSendVoiceNote
  // etc. are seams into ChatInputBar's internal state.

  const handleSend = async (text: string) => {
    if (!myJid || !text.trim()) return;
    await chatService.sendTextMessage({
      chatRoomJid,
      isGroupMsg: isGroup,
      text: text.trim(),
      senderJid: myJid,
      senderName: null,
    });
  };

  const handleSendSticker = async (item: PickerMediaItem) => {
    if (!myJid) return;
    await chatService.sendStickerMessage({
      chatRoomJid,
      isGroupMsg: isGroup,
      senderJid: myJid,
      senderName: null,
      item,
    });
  };

  const handleSendGif = async (item: PickerMediaItem) => {
    if (!myJid) return;
    await chatService.sendGifMessage({
      chatRoomJid,
      isGroupMsg: isGroup,
      senderJid: myJid,
      senderName: null,
      item,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Header
        title={title}
        showBack
        onBack={() => navigation.goBack()}
        avatar={{ initials: initialsFor(title) }}
        subtitle={isPeerTyping ? 'typing…' : undefined}
        actions={[
          { key: 'call', label: `Call ${title}`, icon: Phone, disabled: true },
          { key: 'more', label: 'Conversation options', icon: MoreVertical },
        ]}
      />

      <FlatList
        style={styles.list}
        data={messages}
        inverted
        keyExtractor={(item) => String(item._ID)}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.4}
        // Inverted + newest-first data: ListHeaderComponent renders at the
        // visual bottom (right above the composer), which is where a
        // "peer is typing" indicator belongs.
        ListHeaderComponent={isPeerTyping ? <TypingIndicator /> : null}
        renderItem={({ item }) => (
          <MessageBubbleRow
            message={item}
            chatRoomJid={chatRoomJid}
            myJid={myJid}
            isGroup={isGroup}
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Say hello 👋</Text>
            </View>
          ) : null
        }
      />

      <ChatInputBar
        onSend={handleSend}
        onAttach={() => {}}
        stickers={stickers}
        gifs={gifs}
        onSendSticker={handleSendSticker}
        onSendGif={handleSendGif}
      />
    </SafeAreaView>
  );
}

function MessageBubbleRow({
  message,
  chatRoomJid,
  myJid,
  isGroup,
}: {
  message: ChatMessage;
  chatRoomJid: string;
  myJid: string | null;
  isGroup: boolean;
}) {
  const styles = useStyles(makeStyles);
  const direction = message.CREATOR_JID === myJid ? 'outgoing' : 'incoming';
  const status = deriveMessageStatus(message);
  const reactions = useMessageReactions(chatRoomJid, message.SENDER_MSG_ID);
  // MessageBubble's status prop only models sent/delivered/seen (outgoing-only).
  // 'pending' has no distinct bubble treatment yet (shows as freshly 'sent');
  // 'failed' additionally renders the caption below.
  const bubbleStatus = status === 'read' ? 'seen' : status === 'delivered' ? 'delivered' : 'sent';

  return (
    <View>
      <MessageBubble
        direction={direction}
        context={isGroup ? 'group' : 'direct'}
        senderName={message.SENDER_NAME ?? undefined}
        content={
          message.MSG_TYPE === MSG_TYPE.STICKER
            ? { kind: 'sticker', source: { uri: message.MEDIA_CLOUD ?? '' } }
            : message.MSG_TYPE === MSG_TYPE.GIF
              ? { kind: 'gif', source: { uri: message.MEDIA_CLOUD ?? '' } }
              : { kind: 'text', text: message.MSG_TEXT ?? '' }
        }
        timestamp={formatTime(message.CREATED_TIME)}
        status={direction === 'outgoing' ? bubbleStatus : undefined}
      />
      {reactions.length > 0 ? (
        <View style={styles.reactionsRow}>
          {reactions.map((r) => (
            <ReactionPill key={r.emoji} emoji={r.emoji} count={r.count} />
          ))}
        </View>
      ) : null}
      {status === 'failed' ? <FailedCaption /> : null}
    </View>
  );
}

function FailedCaption() {
  const styles = useStyles(makeStyles);
  return <Text style={styles.failedCaption}>Failed to send · tap to retry</Text>;
}

function formatTime(epochMs: number | null): string {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    list: { flex: 1, paddingHorizontal: spacing.gutterChat },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    reactionsRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    failedCaption: {
      ...typography.labelSm,
      color: colors.error,
      alignSelf: 'flex-end',
      marginBottom: spacing.sm,
    },
  });
