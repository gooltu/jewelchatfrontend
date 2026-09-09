import { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  type ThemeColors,
  spacing,
  radius,
  typography,
  SVGImageIcon,
  ButtonPrimary,
  type SVGIconName,
} from '@components/design-system';
import type { AuthScreenProps } from '@navigation/types';

interface Slide {
  icon: SVGIconName;
  title: string;
  body: string;
}

// Placeholder content/art — swap for real onboarding copy and illustrations.
const SLIDES: Slide[] = [
  { icon: 'j3', title: 'Chat with anyone', body: 'Fast, reliable messaging built for your community.' },
  { icon: 'diamond', title: 'Earn rewards', body: 'Collect gems and rewards as you stay active.' },
  { icon: 'coin', title: 'Play together', body: 'Jump into games with friends, right from chat.' },
];

export function OnboardingScreen({ navigation }: AuthScreenProps<'Onboarding'>) {
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const [activePage, setActivePage] = useState(0);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / width);
    setActivePage(page);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width }]}>
            <SVGImageIcon icon={slide.icon} size={140} />
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((slide, index) => (
          <View
            key={slide.title}
            style={[styles.dot, index === activePage ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <ButtonPrimary label="Get Started" onPress={() => navigation.navigate('PhoneEntry')} />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    slide: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
    title: { ...typography.headlineMd, color: colors.onSurface, marginTop: spacing.lg, textAlign: 'center' },
    body: {
      ...typography.bodyMd,
      color: colors.onSurfaceVariant,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.lg },
    dot: { width: 8, height: 8, borderRadius: radius.full },
    dotActive: { backgroundColor: colors.primary },
    dotInactive: { backgroundColor: colors.outlineVariant },
    footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  });
