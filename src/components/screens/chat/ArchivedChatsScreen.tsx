import { useLayoutEffect } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStyles, type ThemeColors, spacing, EmptyState, SkeletonRow } from '@components/design-system';
import { useArchivedConversations } from '@hooks/useArchivedConversations';
import * as chatService from '@services/chatService';
import { ChatListRow } from './ChatListScreen';
import type { RootScreenProps } from '@navigation/types';
import type { Conversation } from '@app-types/chat';

/**
 * Archived conversations — reachable from ChatListScreen's "Archived (N)"
 * row. Same row rendering as the main chat list (ChatListRow, exported for
 * exactly this reuse). Long-press only offers Unarchive, applied directly —
 * no nested menu, since there's only ever the one action here.
 */
export function ArchivedChatsScreen({ navigation }: RootScreenProps<'ArchivedChats'>) {
  const styles = useStyles(makeStyles);
  const { conversations, loading } = useArchivedConversations();

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Archived Chats' });
  }, [navigation]);

  const openConversation = (conversation: Conversation) => {
    if (!conversation.JID) return;
    navigation.navigate('ChatDetail', {
      chatRoomJid: conversation.JID,
      title: conversation.CONTACT_NAME ?? conversation.PHONEBOOK_CONTACT_NAME ?? 'Unknown User',
      isGroup: conversation.IS_GROUP === 1,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.list}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (conversations.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <EmptyState title="No archived chats" description="Archived conversations show up here." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item._ID)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <ChatListRow
            conversation={item}
            onPress={() => openConversation(item)}
            onLongPress={() => item.JID && void chatService.setConversationArchived(item.JID, false)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    list: { flex: 1 },
    listContent: { paddingBottom: spacing.lg },
  });
