import { useLayoutEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStyles, type ThemeColors, spacing, typography, states, EmptyState } from '@components/design-system';
import { useStarredMessages } from '@hooks/useStarredMessages';
import { messageTestID } from '@components/shared/testIDs';
import { useConversations } from '@hooks/useConversations';
import type { RootScreenProps } from '@navigation/types';
import type { ChatMessage } from '@app-types/chat';
import { conversationDisplayName } from '../../../utils/contactDisplay';

/**
 * Every starred message across every conversation, newest first. Tapping a
 * row opens that conversation — v1 scope doesn't jump to the specific
 * message (would need pagination-cursor work beyond this), see the
 * message-actions plan.
 */
export function StarredMessagesScreen({ navigation }: RootScreenProps<'StarredMessages'>) {
  const styles = useStyles(makeStyles);
  const { messages, loading } = useStarredMessages();
  const { conversations } = useConversations();

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Starred Messages' });
  }, [navigation]);

  const openConversation = (message: ChatMessage) => {
    if (!message.CHAT_ROOM_JID) return;
    const contact = conversations.find((c) => c.JID === message.CHAT_ROOM_JID);
    navigation.navigate('ChatDetail', {
      chatRoomJid: message.CHAT_ROOM_JID,
      title: conversationDisplayName(contact),
      isGroup: contact?.IS_GROUP === 1,
    });
  };

  if (!loading && messages.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <EmptyState
          testID="starred.empty"
          title="No starred messages" description="Star a message to find it here later." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        testID="starred.list"
        data={messages}
        keyExtractor={(item) => String(item._ID)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const contact = conversations.find((c) => c.JID === item.CHAT_ROOM_JID);
          const roomName = conversationDisplayName(contact);
          return (
            <Pressable
              testID={messageTestID(item, 'starred')}
              onPress={() => openConversation(item)}
              style={({ pressed }) => [styles.row, pressed && { opacity: states.pressedOpacity }]}
            >
              <Text style={[typography.headlineMd, styles.roomName]} numberOfLines={1}>
                {roomName}
              </Text>
              <Text style={[typography.bodyMd, styles.snippet]} numberOfLines={2}>
                {item.MSG_TEXT ?? ''}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    listContent: { paddingBottom: spacing.lg },
    row: {
      paddingHorizontal: spacing.marginMobile,
      paddingVertical: spacing.sm,
      gap: spacing.xs,
    },
    roomName: { color: colors.onSurface },
    snippet: { color: colors.onSurfaceVariant },
  });
