import { useState } from 'react';
import { Edit3, MoreVertical, Search } from 'lucide-react-native';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  Header,
  ChatListItem,
  EmptyState,
  FloatingButton,
  InputField,
  SkeletonRow,
} from '@components/design-system';
import { useConversations } from '@hooks/useConversations';
import type { ChatScreenProps } from '@navigation/types';
import type { Conversation } from '@app-types/chat';

const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');

export function ChatListScreen({ navigation }: ChatScreenProps<'ChatList'>) {
  const styles = useStyles(makeStyles);
  const { conversations, loading } = useConversations();
  const [query, setQuery] = useState('');

  const filtered = conversations.filter((c) =>
    (c.CONTACT_NAME ?? c.PHONEBOOK_CONTACT_NAME ?? c.JID ?? '')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  const openConversation = (conversation: Conversation) => {
    if (!conversation.JID) return;
    navigation.navigate('ChatDetail', {
      chatRoomJid: conversation.JID,
      title: conversation.CONTACT_NAME ?? conversation.PHONEBOOK_CONTACT_NAME ?? conversation.JID,
      isGroup: conversation.IS_GROUP === 1,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Header
        title="Chats"
        actions={[
          { key: 'crates', label: '3 crates', image: crateIcon },
          { key: 'gems', label: '24 gems', image: gemIcon },
          { key: 'more', label: 'Chats options', icon: MoreVertical },
        ]}
        gamebar={{ level: 1, xpCurrent: 0, xpMax: 300 }}
      />

      <View style={styles.searchWrap}>
        <InputField
          icon={Search}
          placeholder="Search messages"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? 'No results' : 'No conversations yet'}
          description={
            query
              ? `Nothing matches "${query}". Try a different name.`
              : 'Start a conversation and it will show up here.'
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item._ID)}
          contentContainerStyle={styles.listContent}
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

      <FloatingButton
        icon={Edit3}
        label="New message"
        onPress={() => navigation.navigate('SelectContact')}
        style={styles.fab}
      />
    </SafeAreaView>
  );
}

function formatTimestamp(epochMs: number | null): string {
  if (!epochMs) return '';
  const date = new Date(epochMs);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function initialsFor(name: string | null | undefined): string {
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
    searchWrap: { paddingHorizontal: spacing.marginMobile, paddingVertical: spacing.sm },
    list: { flex: 1 },
    listContent: { paddingBottom: spacing.lg },
    fab: {
      position: 'absolute',
      right: spacing.md,
      bottom: spacing.lg,
    },
  });
