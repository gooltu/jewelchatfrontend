import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { useAppSelector } from '@store/hooks';
import { AuthNavigator } from './AuthNavigator';
import { TabNavigator } from './TabNavigator';
import type { RootStackParamList } from './types';

/** Exposed so notifications/pushNotifications.ts can navigate from outside React (deep links). */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Root switch navigator: AuthNavigator vs TabNavigator, driven by authSlice's status. */
export function AppNavigator() {
  const status = useAppSelector((state) => state.auth.status);

  return (
    <NavigationContainer ref={navigationRef}>
      {status === 'signedIn' ? <TabNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
