import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  Header,
  ChatListItem,
  EmptyState,
  SkeletonRow,
} from '@components/design-system';
import { useConversations } from '@hooks/useConversations';
import type { ChatScreenProps } from '@navigation/types';
import type { Conversation } from '@app-types/chat';

export function ChatListScreen({ navigation }: ChatScreenProps<'ChatList'>) {
  const styles = useStyles(makeStyles);
  const { conversations, loading } = useConversations();

  const openConversation = (conversation: Conversation) => {
    if (!conversation.JID) return;
    navigation.navigate('ChatDetail', {
      chatRoomJid: conversation.JID,
      title: conversation.CONTACT_NAME ?? conversation.PHONEBOOK_CONTACT_NAME ?? conversation.JID,
      isGroup: conversation.IS_GROUP === 1,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title="Chats" />

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : conversations.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Start a conversation and it will show up here."
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item._ID)}
          renderItem={({ item }) => (
            <ChatListItem
              name={item.CONTACT_NAME ?? item.PHONEBOOK_CONTACT_NAME ?? item.JID ?? 'Unknown'}
              snippet={item.MSG_TEXT ?? ''}
              timestamp={formatTimestamp(item.LAST_MSG_CREATED_TIME)}
              avatarInitials={initialsFor(item.CONTACT_NAME ?? item.PHONEBOOK_CONTACT_NAME)}
              unreadCount={item.UNREAD_COUNT}
              onPress={() => openConversation(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function formatTimestamp(epochMs: number | null): string {
  if (!epochMs) return '';
  const date = new Date(epochMs);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initialsFor(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    list: { flex: 1 },
  });
