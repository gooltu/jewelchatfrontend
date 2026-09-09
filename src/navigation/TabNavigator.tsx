import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '@components/screens/chat/ChatListScreen';
import { SettingsScreen } from '@components/screens/profile/SettingsScreen';
import { GamePlaceholderScreen } from '@components/screens/game/GamePlaceholderScreen';
import { renderTabBar } from './TabBarAdapter';
import type { ChatStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();

/** ChatDetail/SelectContact/ContactProfile live on the root stack now, not
 * here — see the doc comment on RootStackParamList in ./types.ts. */
function ChatsStackNavigator() {
  return (
    <ChatStack.Navigator screenOptions={{ headerShown: false }}>
      <ChatStack.Screen name="ChatList" component={ChatListScreen} />
    </ChatStack.Navigator>
  );
}

export function TabNavigator() {
  return (
    <Tab.Navigator tabBar={renderTabBar} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="ChatsTab" component={ChatsStackNavigator} />
      <Tab.Screen name="GameTab" component={GamePlaceholderScreen} />
      <Tab.Screen name="ProfileTab" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
