import { useLayoutEffect, useState } from 'react';
import { Edit3, MoreVertical, Search } from 'lucide-react-native';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  type PresenceState,
  spacing,
  ChatListItem,
  EmptyState,
  FloatingButton,
  InputField,
  SkeletonRow,
} from '@components/design-system';
import { JewelStoreSheet } from '@components/shared/JewelStoreSheet';
import { useAvatarSource } from '@hooks/useAvatarSource';
import { useConversations } from '@hooks/useConversations';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useWalletCounts } from '@hooks/useWalletCounts';
import { useAppSelector } from '@store/hooks';
import { presenceSelectors } from '@store/slices/chatSlice';
import * as chatService from '@services/chatService';
import type { ChatScreenProps, AppStackOptions } from '@navigation/types';
import type { Conversation } from '@app-types/chat';

const UNKNOWN_SENDER_LABEL = 'Unknown User';

const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');

export function ChatListScreen({ navigation }: ChatScreenProps<'ChatList'>) {
  const styles = useStyles(makeStyles);
  const { conversations, loading } = useConversations();
  const [query, setQuery] = useState('');
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);
  const gamebar = useGamebarStats();
  const wallet = useWalletCounts();

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: 'Chats',
      headerProps: {
        actions: [
          { key: 'crates', label: `${wallet.diamonds} crates`, image: crateIcon, onPress: () => setJewelStoreVisible(true) },
          { key: 'gems', label: `${wallet.coins} gems`, image: gemIcon, onPress: () => navigation.navigate('Factory') },
          { key: 'more', label: 'Chats options', icon: MoreVertical },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, wallet, gamebar]);

  const filtered = conversations.filter((c) =>
    (c.CONTACT_NAME ?? c.PHONEBOOK_CONTACT_NAME ?? c.JID ?? '')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  const openConversation = (conversation: Conversation) => {
    if (!conversation.JID) return;
    // A bare row (message arrived from a JID we have nothing else on —
    // stropheEvents.ts upserts this the moment such a message is stored)
    // gets resolved lazily on open, mirroring resolveContactOnTap's own
    // "lazy, per-contact, never bulk" discovery timing. Fire-and-forget —
    // the screen transition doesn't wait on the round trip.
    if (!conversation.CONTACT_NAME && !conversation.PHONEBOOK_CONTACT_NAME && !conversation.JEWELCHAT_ID) {
      void chatService.resolveUnknownSender(conversation.JID);
    }
    navigation.navigate('ChatDetail', {
      chatRoomJid: conversation.JID,
      title: conversation.CONTACT_NAME ?? conversation.PHONEBOOK_CONTACT_NAME ?? UNKNOWN_SENDER_LABEL,
      isGroup: conversation.IS_GROUP === 1,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={[]}>
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
          renderItem={({ item }) => <ChatListRow conversation={item} onPress={() => openConversation(item)} />}
        />
      )}

      <FloatingButton
        icon={Edit3}
        label="New message"
        onPress={() => navigation.navigate('SelectContact')}
        style={styles.fab}
      />

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
    </SafeAreaView>
  );
}

/**
 * Extracted per-row component (mirrors ChatDetailScreen's MessageBubbleRow
 * pattern) — useAvatarSource needs real hooks, which a FlatList renderItem
 * callback can't own directly.
 */
function ChatListRow({ conversation, onPress }: { conversation: Conversation; onPress: () => void }) {
  const avatarSource = useAvatarSource(conversation.JID);
  // Group presence isn't a single-person concept (same scope ChatDetailScreen
  // draws) — only look it up for 1:1 rows.
  const presenceEntry = useAppSelector((state) =>
    conversation.IS_GROUP === 1 || !conversation.JID
      ? undefined
      : presenceSelectors.selectById(state, conversation.JID),
  );
  const presence: PresenceState = !presenceEntry ? 'none' : presenceEntry.isOnline ? 'online' : 'offline';
  return (
    <ChatListItem
      name={conversation.CONTACT_NAME ?? conversation.PHONEBOOK_CONTACT_NAME ?? UNKNOWN_SENDER_LABEL}
      snippet={conversation.MSG_TEXT ?? ''}
      timestamp={formatTimestamp(conversation.LAST_MSG_CREATED_TIME)}
      avatarSource={avatarSource}
      avatarInitials={initialsFor(conversation.CONTACT_NAME ?? conversation.PHONEBOOK_CONTACT_NAME)}
      presence={presence}
      unreadCount={conversation.UNREAD_COUNT}
      onPress={onPress}
    />
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
