import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
};

export type ChatStackParamList = {
  ChatList: undefined;
  ChatDetail: { chatRoomJid: string; title: string; isGroup: boolean };
};

export type TabParamList = {
  ChatsTab: NavigatorScreenParams<ChatStackParamList>;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<TabParamList>;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;
export type ChatScreenProps<T extends keyof ChatStackParamList> = NativeStackScreenProps<
  ChatStackParamList,
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
