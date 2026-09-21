import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { MoreVertical, Phone } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  type PickerMediaItem,
  type SVGIconName,
  MessageBubble,
  ReactionPill,
  SVGImageIcon,
  SystemLabel,
  Toast,
  TypingIndicator,
  ChatInputBar,
  spacing,
  typography,
} from '@components/design-system';
import { useMessages } from '@hooks/useMessages';
import { useMessageReactions } from '@hooks/useMessageReactions';
import { useMediaPicker } from '@hooks/useMediaPicker';
import { useDisplayName } from '@hooks/useDisplayName';
import { useKeyboardOffset } from '@hooks/useKeyboardOffset';
import { useCanPickJewel } from '@hooks/useCanPickJewel';
import { useAppSelector } from '@store/hooks';
import { typingSelectors } from '@store/slices/chatSlice';
import * as authService from '@services/authService';
import * as chatService from '@services/chatService';
import { deriveMessageStatus } from '@database/messageRepository';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';
import { MSG_TYPE, type ChatMessage } from '@app-types/chat';
import { initialsFor } from './ChatListScreen';

/**
 * A day-divider is a pure render-time derivation over already-loaded
 * messages — never persisted, unlike system-event rows (MSG_TYPE.SYSTEM),
 * which come from the DB like any other message. Both render via the same
 * `SystemLabel`, so they're unified into one unioned list item here.
 */
type ListItem =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'message'; message: ChatMessage };

const JEWEL_ICON_BY_TYPE: Partial<Record<number, SVGIconName>> = {
  3: 'j3',
  6: 'j6',
  9: 'j9',
  12: 'j12',
  15: 'j15',
};

/** Vertical gap between consecutive list items — bubbles, dividers, all of it. */
function ItemSeparator() {
  return <View style={{ height: spacing.xs }} />;
}

function dayLabel(epochMs: number): string {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diffDays = Math.round((startOfDay(Date.now()) - startOfDay(epochMs)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return new Date(epochMs).toLocaleDateString();
}

/**
 * `messages` is newest-first (matches the inverted FlatList). A divider for
 * day D belongs right after the oldest message of day D in this array —
 * visually that's directly above D's messages and below the next (older)
 * day's, which is exactly where a chat app's date divider goes.
 */
function buildListItems(messages: ChatMessage[]): ListItem[] {
  const items: ListItem[] = [];
  messages.forEach((message, index) => {
    items.push({ kind: 'message', message });
    const next = messages[index + 1];
    const currentTime = message.CREATED_TIME ?? Date.now();
    const sameDay =
      next && new Date(currentTime).toDateString() === new Date(next.CREATED_TIME ?? currentTime).toDateString();
    if (!sameDay) {
      items.push({ kind: 'divider', key: `divider-${currentTime}-${index}`, label: dayLabel(currentTime) });
    }
  });
  return items;
}

export function ChatDetailScreen({ route, navigation }: RootScreenProps<'ChatDetail'>) {
  const { chatRoomJid, title, isGroup } = route.params;
  const styles = useStyles(makeStyles);
  const myJid = useAppSelector((state) => state.auth.jid);
  const { messages, loading, hasMore, loadMore } = useMessages(chatRoomJid);
  const listItems = useMemo(() => buildListItems(messages), [messages]);
  const isPeerTyping = useAppSelector(
    (state) => typingSelectors.selectById(state, chatRoomJid)?.isTyping ?? false,
  );
  const stickers = useMediaPicker('stickers');
  const gifs = useMediaPicker('gifs');
  const keyboardOffset = useKeyboardOffset();
  const listAnimatedStyle = useAnimatedStyle(() => ({ marginBottom: keyboardOffset.value }));
  const [jewelboxFullVisible, setJewelboxFullVisible] = useState(false);
  const handleJewelboxFull = useCallback(() => setJewelboxFullVisible(true), []);
  const dismissJewelboxFull = useCallback(() => setJewelboxFullVisible(false), []);

  useEffect(() => {
    chatService.setActiveConversation(chatRoomJid);
    return () => chatService.setActiveConversation(null);
  }, [chatRoomJid]);

  // Flushes any jewels picked in this conversation to the backend as soon
  // as the user navigates away — see authService.flushPickedJewels (also
  // triggered on app background/foreground, for the case this never fires
  // because the app was killed instead). Uses 'beforeRemove', not 'blur':
  // confirmed via live testing that popping this screen (back button) fires
  // 'beforeRemove' and unmounts reliably, but never dispatches 'blur' before
  // this effect's own cleanup (which unsubscribes) already runs — 'blur'
  // arrives too late (if at all) for a pop specifically, so it silently
  // never fires.
  useEffect(() => {
    return navigation.addListener('beforeRemove', () => {
      if (__DEV__) console.log('[ChatDetailScreen] beforeRemove fired, flushing picked jewels');
      void authService.flushPickedJewels();
    });
  }, [navigation]);

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title,
      headerProps: {
        avatar: { initials: initialsFor(title) },
        subtitle: isPeerTyping ? 'typing…' : undefined,
        onTitlePress: isGroup ? () => navigation.navigate('GroupInfo', { chatRoomJid, title }) : undefined,
        actions: [
          { key: 'call', label: `Call ${title}`, icon: Phone, disabled: true },
          { key: 'more', label: 'Conversation options', icon: MoreVertical },
        ],
      },
    };
    navigation.setOptions(options);
  }, [navigation, title, isPeerTyping, isGroup, chatRoomJid]);

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
      <Animated.FlatList
        style={[styles.list, listAnimatedStyle]}
        contentContainerStyle={styles.listContent}
        data={listItems}
        inverted
        keyExtractor={(item) => (item.kind === 'divider' ? item.key : String(item.message._ID))}
        ItemSeparatorComponent={ItemSeparator}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.4}
        // Inverted + newest-first data: ListHeaderComponent renders at the
        // visual bottom (right above the composer), which is where a
        // "peer is typing" indicator belongs.
        ListHeaderComponent={isPeerTyping ? <TypingIndicator /> : null}
        renderItem={({ item }) => {
          if (item.kind === 'divider') {
            return (
              <View style={styles.dividerRow}>
                <SystemLabel text={item.label} />
              </View>
            );
          }
          if (item.message.MSG_TYPE === MSG_TYPE.SYSTEM) {
            return (
              <View style={styles.dividerRow}>
                <SystemLabel text={item.message.MSG_TEXT ?? ''} />
              </View>
            );
          }
          return (
            <MessageBubbleRow
              message={item.message}
              chatRoomJid={chatRoomJid}
              myJid={myJid}
              isGroup={isGroup}
              onJewelCapped={handleJewelboxFull}
            />
          );
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Say hello 👋</Text>
            </View>
          ) : null
        }
      />

      {jewelboxFullVisible ? (
        <View style={styles.toastWrap}>
          <Toast
            variant="warning"
            title="Jewelbox full"
            description="You can't pick any more jewels right now."
            onDismiss={dismissJewelboxFull}
          />
        </View>
      ) : null}

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
  onJewelCapped,
}: {
  message: ChatMessage;
  chatRoomJid: string;
  myJid: string | null;
  isGroup: boolean;
  onJewelCapped: () => void;
}) {
  const styles = useStyles(makeStyles);
  const direction = message.CREATOR_JID === myJid ? 'outgoing' : 'incoming';
  const status = deriveMessageStatus(message);
  // Group sender names resolve via the game server, never a raw JID (see
  // useDisplayName/identityService.ts) — 1-1 doesn't need this, so it's
  // skipped there and SENDER_NAME (already resolved for 1-1) is used as-is.
  // Falls back to the stored SENDER_NAME while the resolved name is in
  // flight, rather than a blank flash on first appearance.
  const resolvedSenderName = useDisplayName(isGroup ? message.CREATOR_JID : null);
  const reactions = useMessageReactions(chatRoomJid, message.SENDER_MSG_ID);
  // MessageBubble's status prop only models sent/delivered/seen (outgoing-only).
  // 'pending' has no distinct bubble treatment yet (shows as freshly 'sent');
  // 'failed' additionally renders the caption below.
  const bubbleStatus = status === 'read' ? 'seen' : status === 'delivered' ? 'delivered' : 'sent';
  const jewelIconType = message.JEWEL_TYPE ? JEWEL_ICON_BY_TYPE[message.JEWEL_TYPE] : undefined;
  const canPickJewel = useCanPickJewel();
  // Seeded once at mount, not re-derived from `message` on every render:
  // once the jewel is tapped, chatService.pickJewel flips IS_JEWEL_PICKED in
  // SQLite, which would otherwise yank this row's icon away mid-animation.
  // Pinning it here means only this component's own animation-end callback
  // (below) decides when the slot actually goes away.
  const [jewelVisible, setJewelVisible] = useState(
    direction === 'incoming' && !!jewelIconType && !message.IS_JEWEL_PICKED,
  );

  return (
    <View>
      <View style={jewelVisible ? styles.jewelRow : undefined}>
        {jewelVisible && jewelIconType ? (
          <JewelPickIcon
            icon={jewelIconType}
            canPick={canPickJewel}
            onPick={() => void chatService.pickJewel(message)}
            onCapped={onJewelCapped}
            onAnimationEnd={() => setJewelVisible(false)}
          />
        ) : null}
        <MessageBubble
          direction={direction}
          context={isGroup ? 'group' : 'direct'}
          senderName={resolvedSenderName ?? message.SENDER_NAME ?? undefined}
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
      </View>
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

const JEWEL_PICK_ANIMATION_MS = 200;

/**
 * Tapping shrinks + fades the icon out, then tells the parent to stop
 * rendering it — see MessageBubbleRow's jewelVisible state for why the
 * removal is driven by this animation finishing, not by IS_JEWEL_PICKED.
 * A tap while `canPick` is false is a no-op beyond surfacing the
 * jewelbox-full toast: no animation, nothing picked.
 */
function JewelPickIcon({
  icon,
  canPick,
  onPick,
  onCapped,
  onAnimationEnd,
}: {
  icon: SVGIconName;
  canPick: boolean;
  onPick: () => void;
  onCapped: () => void;
  onAnimationEnd: () => void;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePress = () => {
    if (!canPick) {
      onCapped();
      return;
    }
    onPick();
    // Reanimated's documented API: mutating `.value` outside the render
    // body is how a JS-thread event handler drives a shared value — not a
    // real render-purity violation, same pattern already used in
    // useKeyboardOffset.ts (there the mutation sits inside a Keyboard
    // listener instead of a Pressable handler, which the linter doesn't
    // flag, but it's the identical Reanimated contract).
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withTiming(0, { duration: JEWEL_PICK_ANIMATION_MS });
    // eslint-disable-next-line react-hooks/immutability
    opacity.value = withTiming(0, { duration: JEWEL_PICK_ANIMATION_MS }, (finished) => {
      if (finished) runOnJS(onAnimationEnd)();
    });
  };

  return (
    <Pressable onPress={handlePress} hitSlop={8}>
      <Animated.View style={animatedStyle}>
        <SVGImageIcon icon={icon} size={24} />
      </Animated.View>
    </Pressable>
  );
}

function formatTime(epochMs: number | null): string {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    // Floats over the message list rather than sitting in-flow (was between
    // the list and ChatInputBar) so showing/dismissing it never shifts
    // ChatInputBar or the list's scroll position.
    toastWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingHorizontal: spacing.gutterChat,
      paddingTop: spacing.sm,
    },
    list: { flex: 1, paddingHorizontal: spacing.gutterChat },
    // Inverted list: paddingTop here renders as the gap at the visual
    // *bottom* (between the newest bubble and ChatInputBar), not the top.
    listContent: { paddingTop: spacing.sm },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    dividerRow: { paddingVertical: spacing.sm },
    jewelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
