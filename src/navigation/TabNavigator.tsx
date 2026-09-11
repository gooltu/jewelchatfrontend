import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChatListScreen } from '@components/screens/chat/ChatListScreen';
import { SettingsScreen } from '@components/screens/profile/SettingsScreen';
import { GameScreen } from '@components/screens/game/GameScreen';
import { renderTabBar } from './TabBarAdapter';
import { renderHeader } from './HeaderAdapter';
import type { ChatStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();

/** ChatDetail/SelectContact/ContactProfile live on the root stack now, not
 * here — see the doc comment on RootStackParamList in ./types.ts. */
function ChatsStackNavigator() {
  return (
    <ChatStack.Navigator screenOptions={{ header: renderHeader }}>
      <ChatStack.Screen name="ChatList" component={ChatListScreen} />
    </ChatStack.Navigator>
  );
}

export function TabNavigator() {
  return (
    <Tab.Navigator tabBar={renderTabBar} screenOptions={{ header: renderHeader }}>
      {/* ChatsTab renders its own header via the nested ChatStack's
          screenOptions above — headerShown: false here avoids a second,
          outer tab-level header stacking on top of it. */}
      <Tab.Screen name="ChatsTab" component={ChatsStackNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="GameTab" component={GameScreen} />
      <Tab.Screen name="ProfileTab" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
