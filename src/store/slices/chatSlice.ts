import { createSlice, createEntityAdapter, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';

/**
 * Ephemeral/UI chat state only. Message history and conversation metadata
 * live in SQLite (see src/database/) — this slice never holds a message
 * list. Collections here use createEntityAdapter, keyed by conversation
 * JID: per-JID typing indicators and per-JID unsent draft text.
 */

export type XmppConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

interface TypingEntry {
  /** Conversation JID — entity adapter id. */
  jid: string;
  isTyping: boolean;
  updatedAt: number;
}

interface DraftEntry {
  /** Conversation JID — entity adapter id. */
  jid: string;
  text: string;
  updatedAt: number;
}

const typingAdapter = createEntityAdapter<TypingEntry, string>({
  selectId: (entry) => entry.jid,
});

const draftsAdapter = createEntityAdapter<DraftEntry, string>({
  selectId: (entry) => entry.jid,
});

interface ChatState {
  activeConversationJid: string | null;
  connectionStatus: XmppConnectionStatus;
  typing: ReturnType<typeof typingAdapter.getInitialState>;
  drafts: ReturnType<typeof draftsAdapter.getInitialState>;
}

const initialState: ChatState = {
  activeConversationJid: null,
  connectionStatus: 'disconnected',
  typing: typingAdapter.getInitialState(),
  drafts: draftsAdapter.getInitialState(),
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    activeConversationSet(state, action: PayloadAction<string | null>) {
      state.activeConversationJid = action.payload;
    },
    connectionStatusChanged(state, action: PayloadAction<XmppConnectionStatus>) {
      state.connectionStatus = action.payload;
    },
    typingReceived(state, action: PayloadAction<{ jid: string; isTyping: boolean }>) {
      typingAdapter.upsertOne(state.typing, {
        jid: action.payload.jid,
        isTyping: action.payload.isTyping,
        updatedAt: Date.now(),
      });
    },
    draftChanged(state, action: PayloadAction<{ jid: string; text: string }>) {
      if (action.payload.text.length === 0) {
        draftsAdapter.removeOne(state.drafts, action.payload.jid);
        return;
      }
      draftsAdapter.upsertOne(state.drafts, {
        jid: action.payload.jid,
        text: action.payload.text,
        updatedAt: Date.now(),
      });
    },
    draftCleared(state, action: PayloadAction<string>) {
      draftsAdapter.removeOne(state.drafts, action.payload);
    },
    /**
     * Called on app backgrounding (see useAppState.ts). connectionStatus/
     * activeConversationJid/typing are all stale the instant the app
     * backgrounds — the OS can kill the underlying XMPP socket without
     * warning, so a cached 'connected' status left over from before
     * backgrounding caused resyncAfterForeground to skip reconnecting and
     * call broadcastPresence() on a dead socket (INVALID_STATE_ERR).
     * Drafts are deliberately untouched — losing a half-typed message on
     * every app-switch would be a real regression.
     */
    chatSessionReset(state) {
      state.connectionStatus = 'disconnected';
      state.activeConversationJid = null;
      state.typing = typingAdapter.getInitialState();
    },
  },
});

export const {
  activeConversationSet,
  connectionStatusChanged,
  typingReceived,
  draftChanged,
  draftCleared,
  chatSessionReset,
} = chatSlice.actions;

export default chatSlice.reducer;

export const typingSelectors = typingAdapter.getSelectors<RootState>((state) => state.chat.typing);
export const draftsSelectors = draftsAdapter.getSelectors<RootState>((state) => state.chat.drafts);
