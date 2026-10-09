import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MoreVertical, Phone } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioRecorder,
  useAudioPlayer,
  useAudioPlayerStatus,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
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
import { useAvatarSource } from '@hooks/useAvatarSource';
import { useDisplayName } from '@hooks/useDisplayName';
import { setTransientBackgroundExpected } from '@hooks/useAppState';
import { useKeyboardOffset } from '@hooks/useKeyboardOffset';
import { useCanPickJewel } from '@hooks/useCanPickJewel';
import { useResolvedMediaUri } from '@hooks/useResolvedMediaUri';
import { useVoicePlayback } from '@hooks/useVoicePlayback';
import { useAppSelector } from '@store/hooks';
import { typingSelectors, presenceSelectors } from '@store/slices/chatSlice';
import * as authService from '@services/authService';
import * as chatService from '@services/chatService';
import {
  checkMediaCaps,
  checkVoiceCaps,
  prepareImageForUpload,
  prepareVideoForUpload,
  prepareVoiceForUpload,
  msToClockString,
  clockStringToMs,
} from '@media/mediaUploadService';
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
  { kind: 'divider'; key: string; label: string } | { kind: 'message'; message: ChatMessage };

const JEWEL_ICON_BY_TYPE: Partial<Record<number, SVGIconName>> = {
  3: 'j3',
  6: 'j6',
  9: 'j9',
  12: 'j12',
  15: 'j15',
};

/**
 * image/gif/video bubble content kinds all require a non-optional
 * source/thumbnail (no loading-scrim prop exists on them, confirmed in the
 * chat-media plan) — before useResolvedMediaUri resolves (or for a
 * never-populated MEDIA_CLOUD), `source.uri` must still be *some* valid
 * URI. `{ uri: '' }` isn't one — RN warns "source.uri should not be an
 * empty string" — so this 1x1 transparent PNG data URI stands in instead:
 * a real, loadable, invisible placeholder.
 */
const TRANSPARENT_PIXEL_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
      next &&
      new Date(currentTime).toDateString() ===
        new Date(next.CREATED_TIME ?? currentTime).toDateString();
    if (!sameDay) {
      items.push({
        kind: 'divider',
        key: `divider-${currentTime}-${index}`,
        label: dayLabel(currentTime),
      });
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
  // Group presence isn't a single-person concept — 1:1 only, same scope the
  // existing onIdentityPress group-vs-1:1 branch already draws.
  const presence = useAppSelector((state) =>
    isGroup ? undefined : presenceSelectors.selectById(state, chatRoomJid),
  );
  const stickers = useMediaPicker('stickers');
  const gifs = useMediaPicker('gifs');
  const keyboardOffset = useKeyboardOffset();
  const listAnimatedStyle = useAnimatedStyle(() => ({ marginBottom: keyboardOffset.value }));
  const [jewelboxFullVisible, setJewelboxFullVisible] = useState(false);
  const handleJewelboxFull = useCallback(() => setJewelboxFullVisible(true), []);
  const dismissJewelboxFull = useCallback(() => setJewelboxFullVisible(false), []);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const dismissMediaError = useCallback(() => setMediaError(null), []);
  const voiceRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Hands the finalized recording off from onRecordingStop to
  // onSendVoiceNote — ChatInputBar's mock only carries duration/waveform
  // through that callback, not the real file, so this is the one place the
  // actual recorded file lives in between.
  const pendingVoiceUriRef = useRef<string | null>(null);
  // Backs ChatInputBar's review-step preview (previewPlaying/
  // onTogglePreviewPlayback) with real playback of the just-finalized
  // recording — set once in onRecordingStop, cleared on discard/send.
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const previewPlayer = useAudioPlayer(previewUri);
  const previewStatus = useAudioPlayerStatus(previewPlayer);
  // 1:1 only — a group header represents the whole room, not one person;
  // group photo is out of scope here (see profile-picture-upload-and-display plan).
  const headerAvatarSource = useAvatarSource(isGroup ? null : chatRoomJid);

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
        avatar: { source: headerAvatarSource, initials: initialsFor(title) },
        subtitle: isPeerTyping
          ? 'typing…'
          : presence?.isOnline
            ? 'Online'
            : presence?.lastSeenMs
              ? `Last seen ${formatTime(presence.lastSeenMs)}`
              : undefined,
        // Tints the subtitle text + the header avatar's presence dot (see
        // @nocturnalflow/design-system's Header/Avatar) — 'none' renders no
        // dot at all, distinct from 'offline', for a peer we've never
        // actually heard a presence stanza from yet.
        presence: !presence ? 'none' : presence.isOnline ? 'online' : 'offline',
        onIdentityPress: isGroup
          ? () => navigation.navigate('GroupInfo', { chatRoomJid, title })
          : () => navigation.navigate('ProfileDetail', { chatRoomJid, title }),
        actions: [
          { key: 'call', label: `Call ${title}`, icon: Phone, disabled: true },
          { key: 'more', label: 'Conversation options', icon: MoreVertical },
        ],
      },
    };
    navigation.setOptions(options);
  }, [navigation, title, isPeerTyping, presence, isGroup, chatRoomJid, headerAvatarSource]);

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

  /**
   * Mic permission + real capture, wired into ChatInputBar's otherwise
   * UI-only mock recorder (see onSendVoiceNote below). Unlike handleAttach's
   * gallery picker, requesting mic permission and recording are in-process
   * expo-audio calls, not a separate Activity — no
   * setTransientBackgroundExpected wrapping needed here.
   */
  const handleRecordingStart = async () => {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) {
      setMediaError('Microphone access is needed to record a voice message.');
      return;
    }
    // iOS puts the session in the .record/.playAndRecord category while
    // allowsRecording is true, which must be switched back off in
    // handleRecordingStop/handleDiscardRecording below — otherwise a
    // just-recorded file's preview playback comes out silent/routed to the
    // earpiece instead of the speaker (confirmed against the design
    // system's own useVoiceRecorder demo hook, which hit the same thing).
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await voiceRecorder.prepareToRecordAsync();
    voiceRecorder.record();
  };

  const handleRecordingStop = async () => {
    // Not recording means handleRecordingStart's permission request was
    // denied — ChatInputBar's mock UI doesn't know that and still calls
    // onRecordingStop when the user taps its stop button regardless.
    if (!voiceRecorder.isRecording) {
      return;
    }
    await voiceRecorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    pendingVoiceUriRef.current = voiceRecorder.uri ?? null;
    setPreviewUri(voiceRecorder.uri ?? null);
  };

  const handleTogglePreviewPlayback = () => {
    if (previewStatus.playing) {
      previewPlayer.pause();
      return;
    }
    // Resume from pause, but restart from 0 once playback has run out —
    // otherwise a finished preview's play button would look inert.
    const finished = previewStatus.duration > 0 && previewStatus.currentTime >= previewStatus.duration;
    if (finished) previewPlayer.seekTo(0);
    previewPlayer.play();
  };

  const handleDiscardRecording = async () => {
    // Discard can fire mid-recording (trash tapped before stop), so it
    // still needs to stop the recorder and release allowsRecording itself —
    // otherwise the session is left stuck in recording mode for every
    // bubble's playback afterward.
    if (voiceRecorder.isRecording) {
      await voiceRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
    if (previewStatus.playing) previewPlayer.pause();
    pendingVoiceUriRef.current = null;
    setPreviewUri(null);
  };

  const handleSendVoiceNote = async ({ duration }: { duration: string; waveform: number[] }) => {
    const recordedUri = pendingVoiceUriRef.current;
    pendingVoiceUriRef.current = null;
    if (previewStatus.playing) previewPlayer.pause();
    setPreviewUri(null);
    if (!myJid || !recordedUri) {
      setMediaError("Couldn't record that — try again.");
      return;
    }

    const durationMs = clockStringToMs(duration);
    const capCheck = checkVoiceCaps(durationMs);
    if (!capCheck.ok) {
      setMediaError(capCheck.reason ?? "That recording can't be sent.");
      return;
    }

    try {
      const prepared = await prepareVoiceForUpload(recordedUri, durationMs);
      await chatService.sendVoiceMessage({
        chatRoomJid,
        isGroupMsg: isGroup,
        senderJid: myJid,
        senderName: null,
        prepared,
      });
    } catch (error) {
      if (__DEV__) console.log('[ChatDetailScreen] handleSendVoiceNote failed:', error);
      setMediaError("Couldn't prepare that recording — try again.");
    }
  };

  /**
   * Gallery only (no camera) — picks, rejects instantly on cap overage with
   * zero DB/network side effects, then prepares (downscale/thumbnail) before
   * handing off to chatService, which writes the row and renders optimistically
   * from the local file while the upload runs in the background.
   */
  const handleAttach = async () => {
    if (!myJid) return;
    // The picker launches a separate Activity on Android, genuinely
    // pausing this one — see useAppState.ts's setTransientBackgroundExpected
    // doc comment for why that must not trigger a chat-session reset.
    setTransientBackgroundExpected(true);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });
    } finally {
      setTransientBackgroundExpected(false);
    }
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    const capCheck = checkMediaCaps(asset);
    if (!capCheck.ok) {
      setMediaError(capCheck.reason ?? "That file can't be sent.");
      return;
    }

    try {
      if (asset.type === 'video') {
        const prepared = await prepareVideoForUpload(asset);
        await chatService.sendVideoMessage({
          chatRoomJid,
          isGroupMsg: isGroup,
          senderJid: myJid,
          senderName: null,
          prepared,
        });
      } else {
        const prepared = await prepareImageForUpload(asset);
        await chatService.sendImageMessage({
          chatRoomJid,
          isGroupMsg: isGroup,
          senderJid: myJid,
          senderName: null,
          prepared,
        });
      }
    } catch (error) {
      if (__DEV__) console.log('[ChatDetailScreen] handleAttach failed:', error);
      setMediaError("Couldn't prepare that file — try again.");
    }
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
              navigation={navigation}
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

      {mediaError ? (
        <View style={styles.toastWrap}>
          <Toast
            variant="warning"
            title="Can't send that"
            description={mediaError}
            onDismiss={dismissMediaError}
          />
        </View>
      ) : null}

      <ChatInputBar
        onSend={handleSend}
        onAttach={handleAttach}
        stickers={stickers}
        gifs={gifs}
        onSendSticker={handleSendSticker}
        onSendGif={handleSendGif}
        onSendVoiceNote={handleSendVoiceNote}
        onRecordingStart={handleRecordingStart}
        onRecordingStop={handleRecordingStop}
        onDiscardRecording={handleDiscardRecording}
        {...(previewUri
          ? { previewPlaying: previewStatus.playing, onTogglePreviewPlayback: handleTogglePreviewPlayback }
          : {})}
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
  navigation,
}: {
  message: ChatMessage;
  navigation: RootScreenProps<'ChatDetail'>['navigation'];
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
  // MessageBubble's status prop models pending/sent/delivered/seen
  // (outgoing-only) — 'pending' (not yet submitted to the server) draws a
  // clock glyph in place of the ticks. 'failed' isn't a DeliveryState at
  // all; it additionally renders the caption below instead.
  const bubbleStatus =
    status === 'read'
      ? 'seen'
      : status === 'delivered'
        ? 'delivered'
        : status === 'pending'
          ? 'pending'
          : 'sent';
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
  // IMAGE/VIDEO-only (see mediaUploadService.resolveMediaUri) — null args for
  // every other MSG_TYPE are harmless no-ops, kept unconditional so hook
  // order never changes across renders.
  const resolvedImageUri = useResolvedMediaUri(
    message.MSG_TYPE === MSG_TYPE.IMAGE ? message.MEDIA_CLOUD : null,
  );
  const resolvedThumbUri = useResolvedMediaUri(
    message.MSG_TYPE === MSG_TYPE.VIDEO ? message.MEDIA_CLOUD_THUMBNAIL : null,
  );
  const resolvedVoiceUri = useResolvedMediaUri(
    message.MSG_TYPE === MSG_TYPE.VOICE ? message.MEDIA_CLOUD : null,
  );
  const voicePlayback = useVoicePlayback(message._ID, resolvedVoiceUri);
  const mediaAspectRatio =
    message.MEDIA_WIDTH && message.MEDIA_HEIGHT
      ? message.MEDIA_WIDTH / message.MEDIA_HEIGHT
      : undefined;
  // No loading-scrim prop exists on the image/video content kinds (confirmed
  // in the chat-media plan), so the spinner is an app-level overlay rather
  // than something passed through `content`.
  //
  // MEDIA_UPLOADED is only ever a meaningful signal for our *own* outgoing
  // row — insertIncomingMessage (stropheEvents.ts) hardcodes it to 0 for
  // every received message (it's never "uploaded" from this device's
  // perspective) and never flips it, so without the `direction === 'outgoing'`
  // guard this was permanently true for every incoming image/video — the
  // spinner never stopped rotating even once the file had fully downloaded.
  const isUploadingMedia =
    direction === 'outgoing' &&
    (message.MSG_TYPE === MSG_TYPE.IMAGE ||
      message.MSG_TYPE === MSG_TYPE.VIDEO ||
      message.MSG_TYPE === MSG_TYPE.VOICE) &&
    message.MEDIA_UPLOADED === 0 &&
    !message.IS_ERROR;
  // Incoming media has no upload phase — its "still working" state is
  // simply "resolveMediaUri hasn't finished fetching/caching it yet",
  // which resolvedImageUri/resolvedThumbUri/resolvedVoiceUri already track.
  const isDownloadingMedia =
    direction === 'incoming' &&
    ((message.MSG_TYPE === MSG_TYPE.IMAGE && resolvedImageUri === null) ||
      (message.MSG_TYPE === MSG_TYPE.VIDEO && resolvedThumbUri === null) ||
      (message.MSG_TYPE === MSG_TYPE.VOICE && resolvedVoiceUri === null));
  const showMediaSpinner = isUploadingMedia || isDownloadingMedia;

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
        <View style={{ alignSelf: direction === 'outgoing' ? 'flex-end' : 'flex-start' }}>
          <MessageBubble
            direction={direction}
            context={isGroup ? 'group' : 'direct'}
            senderName={resolvedSenderName ?? message.SENDER_NAME ?? undefined}
            content={
              message.MSG_TYPE === MSG_TYPE.STICKER
                ? { kind: 'sticker', source: { uri: message.MEDIA_CLOUD ?? TRANSPARENT_PIXEL_URI } }
                : message.MSG_TYPE === MSG_TYPE.GIF
                  ? { kind: 'gif', source: { uri: message.MEDIA_CLOUD ?? TRANSPARENT_PIXEL_URI } }
                  : message.MSG_TYPE === MSG_TYPE.IMAGE
                    ? {
                        kind: 'image',
                        source: { uri: resolvedImageUri ?? TRANSPARENT_PIXEL_URI },
                        aspectRatio: mediaAspectRatio,
                        onPress: () =>
                          navigation.navigate('MediaViewer', {
                            kind: 'image',
                            key: message.MEDIA_CLOUD ?? '',
                          }),
                      }
                    : message.MSG_TYPE === MSG_TYPE.VIDEO
                      ? {
                          kind: 'video',
                          thumbnail: { uri: resolvedThumbUri ?? TRANSPARENT_PIXEL_URI },
                          duration: msToClockString(message.MEDIA_DURATION_MS ?? 0),
                          aspectRatio: mediaAspectRatio,
                          onPlay: () =>
                            navigation.navigate('MediaViewer', {
                              kind: 'video',
                              key: message.MEDIA_CLOUD ?? '',
                              thumbnailKey: message.MEDIA_CLOUD_THUMBNAIL,
                            }),
                        }
                      : message.MSG_TYPE === MSG_TYPE.VOICE
                        ? {
                            kind: 'voice',
                            duration: msToClockString(message.MEDIA_DURATION_MS ?? 0),
                            playing: voicePlayback.playing,
                            progress: voicePlayback.progress,
                            onTogglePlay: voicePlayback.toggle,
                          }
                        : { kind: 'text', text: message.MSG_TEXT ?? '' }
            }
            timestamp={formatTime(message.CREATED_TIME)}
            status={direction === 'outgoing' ? bubbleStatus : undefined}
          />
          {showMediaSpinner ? (
            <View style={styles.uploadSpinnerWrap} pointerEvents="none">
              <View style={styles.uploadSpinnerBadge}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {reactions.length > 0 ? (
        <View style={styles.reactionsRow}>
          {reactions.map((r) => (
            <ReactionPill key={r.emoji} emoji={r.emoji} count={r.count} />
          ))}
        </View>
      ) : null}
      {status === 'failed' ? (
        <FailedCaption onRetry={() => void chatService.retryFailedMessage(message)} />
      ) : null}
    </View>
  );
}

function FailedCaption({ onRetry }: { onRetry: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onRetry} hitSlop={8}>
      <Text style={styles.failedCaption}>Failed to send · tap to retry</Text>
    </Pressable>
  );
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
    uploadSpinnerWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    uploadSpinnerBadge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
  });
