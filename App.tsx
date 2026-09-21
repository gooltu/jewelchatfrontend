import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as ReduxProvider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { ThemeProvider, useTheme, useThemeColors, useAppFonts } from '@components/design-system';
import { store, persistor } from '@store/index';
import { useAppSelector } from '@store/hooks';
import { AppNavigator } from '@navigation/AppNavigator';
import { FloatingLoadingPanel } from '@components/shared/FloatingLoadingPanel';
import { getDatabase } from '@database/index';
import * as authService from '@services/authService';
// expo-notifications disabled for early development — see app.config.ts.
// import { useNotificationDeepLinking } from '@notifications/pushNotifications';
import { useAppState } from '@hooks/useAppState';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <ReduxProvider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <ThemeProvider>
            <SafeAreaProvider>
              <ThemeBridge>
                <RootContent />
              </ThemeBridge>
            </SafeAreaProvider>
          </ThemeProvider>
        </PersistGate>
      </ReduxProvider>
    </GestureHandlerRootView>
  );
}

/** Keeps @nocturnalflow/design-system's live theme in sync with themeSlice's persisted mode. */
function ThemeBridge({ children }: { children: ReactNode }) {
  const mode = useAppSelector((state) => state.theme.mode);
  const systemScheme = useColorScheme();
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme(mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode);
  }, [mode, systemScheme, setTheme]);

  return <>{children}</>;
}

function RootContent() {
  const [fontsLoaded] = useAppFonts();
  const [dbReady, setDbReady] = useState(false);
  const colors = useThemeColors();

  useEffect(() => {
    authService.configureGameserverAuth();
    void getDatabase().then(() => setDbReady(true));
    void authService.restoreSession();
  }, []);

  useAppState();

  if (!fontsLoaded || !dbReady) return null;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <AppNavigator />
      <FloatingLoadingPanel />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
