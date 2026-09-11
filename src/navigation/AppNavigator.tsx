import { useMemo } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '@components/design-system';
import { useAppSelector } from '@store/hooks';
import { AuthNavigator } from './AuthNavigator';
import { TabNavigator } from './TabNavigator';
import { renderHeader } from './HeaderAdapter';
import { buildNavigationTheme } from './navigationTheme';
import { SplashScreen } from '@components/screens/auth/SplashScreen';
import { ChatDetailScreen } from '@components/screens/chat/ChatDetailScreen';
import { SelectContactScreen } from '@components/screens/chat/SelectContactScreen';
import { ContactProfileScreen } from '@components/screens/chat/ContactProfileScreen';
import { SelectGroupMembersScreen } from '@components/screens/chat/SelectGroupMembersScreen';
import { CreateGroupDetailsScreen } from '@components/screens/chat/CreateGroupDetailsScreen';
import { GroupInfoScreen } from '@components/screens/chat/GroupInfoScreen';
import { TaskDetailScreen } from '@components/screens/game/TaskDetailScreen';
import type { RootStackParamList } from './types';

/** Exposed so notifications/pushNotifications.ts can navigate from outside React (deep links). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const RootStack = createNativeStackNavigator<RootStackParamList>();

/**
 * The signed-in tree: the tab flow plus full-screen pushes over it
 * (ChatDetail/SelectContact/ContactProfile) as root-level siblings of `App`,
 * not nested inside Tab.Navigator's own stack — see RootStackParamList's
 * doc comment in ./types.ts for why (KeyboardAvoidingView measurement bug).
 */
function SignedInNavigator() {
  return (
    <RootStack.Navigator screenOptions={{ header: renderHeader }}>
      <RootStack.Screen name="App" component={TabNavigator} options={{ headerShown: false }} />
      <RootStack.Screen name="ChatDetail" component={ChatDetailScreen} />
      <RootStack.Screen name="SelectContact" component={SelectContactScreen} />
      <RootStack.Screen name="ContactProfile" component={ContactProfileScreen} />
      <RootStack.Screen name="SelectGroupMembers" component={SelectGroupMembersScreen} />
      <RootStack.Screen name="CreateGroupDetails" component={CreateGroupDetailsScreen} />
      <RootStack.Screen name="GroupInfo" component={GroupInfoScreen} />
      <RootStack.Screen name="TaskDetail" component={TaskDetailScreen} />
    </RootStack.Navigator>
  );
}

/** Root switch: Splash (restoring session) vs AuthNavigator vs the signed-in tree, driven by authSlice's status. */
export function AppNavigator() {
  const status = useAppSelector((state) => state.auth.status);
  const { colors, themeName } = useTheme();
  const navigationTheme = useMemo(
    () => buildNavigationTheme(colors, themeName),
    [colors, themeName],
  );

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      {status === 'initializing' ? (
        <SplashScreen />
      ) : status === 'signedIn' ? (
        <SignedInNavigator />
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
