import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SplashScreen } from '@components/screens/auth/SplashScreen';
import { OnboardingScreen } from '@components/screens/auth/OnboardingScreen';
import { PhoneEntryScreen } from '@components/screens/auth/PhoneEntryScreen';
import { OtpScreen } from '@components/screens/auth/OtpScreen';
import { ReferralNicknameScreen } from '@components/screens/auth/ReferralNicknameScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="ReferralNickname" component={ReferralNicknameScreen} />
    </Stack.Navigator>
  );
}
