import { useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  Header,
  MessageBubble,
  ChatInputBar,
  spacing,
  typography,
} from '@components/design-system';
import { useMessages } from '@hooks/useMessages';
import { useAppSelector } from '@store/hooks';
import * as chatService from '@services/chatService';
import { deriveMessageStatus } from '@database/messageRepository';
import type { ChatScreenProps } from '@navigation/types';
import type { ChatMessage } from '@app-types/chat';

export function ChatDetailScreen({ route, navigation }: ChatScreenProps<'ChatDetail'>) {
  const { chatRoomJid, title, isGroup } = route.params;
  const styles = useStyles(makeStyles);
  const myJid = useAppSelector((state) => state.auth.jid);
  const { messages, loading, hasMore, loadMore } = useMessages(chatRoomJid);

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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Header title={title} showBack onBack={() => navigation.goBack()} />

      <FlatList
        style={styles.list}
        data={messages}
        inverted
        keyExtractor={(item) => String(item._ID)}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <MessageBubbleRow message={item} myJid={myJid} isGroup={isGroup} />
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Say hello 👋</Text>
            </View>
          ) : null
        }
      />

      <ChatInputBar onSend={handleSend} onAttach={() => {}} />
    </SafeAreaView>
  );
}

function MessageBubbleRow({
  message,
  myJid,
  isGroup,
}: {
  message: ChatMessage;
  myJid: string | null;
  isGroup: boolean;
}) {
  const direction = message.CREATOR_JID === myJid ? 'outgoing' : 'incoming';
  const status = deriveMessageStatus(message);
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
        content={{ kind: 'text', text: message.MSG_TEXT ?? '' }}
        timestamp={formatTime(message.CREATED_TIME)}
        status={direction === 'outgoing' ? bubbleStatus : undefined}
      />
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
    failedCaption: {
      ...typography.labelSm,
      color: colors.error,
      alignSelf: 'flex-end',
      marginBottom: spacing.sm,
    },
  });
