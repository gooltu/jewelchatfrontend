import type { NativeStackScreenProps, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { BottomTabScreenProps, BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { HeaderProps } from '@components/design-system';

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
  /**
   * `mode: 'create'` (default) proceeds to CreateGroupDetails once the user
   * taps Next. `mode: 'add'` (GroupInfoScreen's "Add members") instead
   * invites each selected contact into `existingGroupJid` directly and pops
   * back — no name step, the group already has one.
   */
  SelectGroupMembers:
    | { mode?: 'create' }
    | { mode: 'add'; existingGroupJid: string };
  CreateGroupDetails: { members: { jid: string; name: string }[] };
  GroupInfo: { chatRoomJid: string; title: string };
  TaskDetail: { taskId: string };
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
/** Composite so GameTab (a bare Tab.Screen, no nested stack) can still type-check navigating up to root-level screens like TaskDetail. */
export type GameScreenProps = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'GameTab'>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  namespace ReactNavigation {
    // Empty on purpose: this is React Navigation's documented TypeScript
    // pattern (declaration-merge RootParamList via `extends`) for global
    // route typing — not a real empty-interface mistake.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}

/** Everything `Header` needs beyond `title`/`onBack` (which the navigator itself
 * derives from `options.title` and the back-stack). Set via `navigation.setOptions`. */
export type HeaderExtraProps = Partial<Omit<HeaderProps, 'title' | 'onBack'>>;

/** `NativeStackNavigationOptions`/`BottomTabNavigationOptions` are `type` aliases in
 * @react-navigation 7.x, not `interface`s, so they can't be declaration-merged —
 * these intersections are the options shape actually passed to `Stack.Screen`/
 * `Tab.Screen`/`navigation.setOptions` throughout `src/`. Matches NocturnalFlowRN's
 * navigation/types.ts. */
export type AppStackOptions = NativeStackNavigationOptions & { headerProps?: HeaderExtraProps };
export type AppTabOptions = BottomTabNavigationOptions & { headerProps?: HeaderExtraProps };
