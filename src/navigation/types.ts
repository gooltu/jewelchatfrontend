import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  PhoneEntry: undefined;
  Otp: { userId: number; phone: string; active: boolean; domain: string };
  ReferralNickname: { userId: number };
};

export type ChatStackParamList = {
  ChatList: undefined;
};

export type TabParamList = {
  ChatsTab: NavigatorScreenParams<ChatStackParamList>;
  GameTab: undefined;
  ProfileTab: undefined;
};

/**
 * ChatDetail/SelectContact/ContactProfile are root-stack screens (siblings
 * of `App`, pushed over the whole tab flow) rather than nested inside
 * ChatStack — nesting them one level deeper under Tab.Navigator's own
 * native-screens container broke KeyboardAvoidingView's on-screen
 * measurement for ChatInputBar on Android. Matches NocturnalFlowRN's
 * RootNavigator, where `Conversation`/`SelectContacts` are root-level pushes
 * alongside `Tabs`, not nested inside the tab flow.
 */
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<TabParamList>;
  ChatDetail: { chatRoomJid: string; title: string; isGroup: boolean };
  SelectContact: undefined;
  ContactProfile: { name: string | null; phone: number | null };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;
/** Composite so ChatList (nested under Tabs > ChatStack) can still type-check navigating up to root-level screens like SelectContact/ChatDetail. */
export type ChatScreenProps<T extends keyof ChatStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ChatStackParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;

declare global {
  namespace ReactNavigation {
    // Empty on purpose: this is React Navigation's documented TypeScript
    // pattern (declaration-merge RootParamList via `extends`) for global
    // route typing — not a real empty-interface mistake.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
