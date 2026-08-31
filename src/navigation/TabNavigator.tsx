import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MessageCircle, Settings as SettingsIcon } from 'lucide-react-native';
import { useThemeColors, iconTokens } from '@components/design-system';
import { ChatListScreen } from '@components/screens/chat/ChatListScreen';
import { ChatDetailScreen } from '@components/screens/chat/ChatDetailScreen';
import { SettingsScreen } from '@components/screens/profile/SettingsScreen';
import type { ChatStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const ChatStack = createNativeStackNavigator<ChatStackParamList>();

function ChatsStackNavigator() {
  return (
    <ChatStack.Navigator screenOptions={{ headerShown: false }}>
      <ChatStack.Screen name="ChatList" component={ChatListScreen} />
      <ChatStack.Screen name="ChatDetail" component={ChatDetailScreen} />
    </ChatStack.Navigator>
  );
}

export function TabNavigator() {
  const colors = useThemeColors();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navActive,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: colors.navBar },
      }}
    >
      <Tab.Screen
        name="ChatsTab"
        component={ChatsStackNavigator}
        options={{
          title: 'Chats',
          tabBarIcon: ({ color }) => <MessageCircle color={color} size={iconTokens.sizeMd} />,
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon color={color} size={iconTokens.sizeMd} />,
        }}
      />
    </Tab.Navigator>
  );
}
