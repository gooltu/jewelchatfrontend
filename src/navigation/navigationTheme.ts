import type { Theme } from '@react-navigation/native';
import { fontFamilies, type ThemeColors, type ThemeName } from '@components/design-system';

/** Maps our theme tokens onto React Navigation's `Theme` shape, so
 * native-stack/bottom-tabs' own screen/tab-bar surfaces (drawn behind our
 * translucent Header/NavigationBar) use the right color instead of their
 * light-mode default — otherwise you get a mismatched white edge/box behind
 * anything blurred or semi-transparent, e.g. the floating tab bar. */
export function buildNavigationTheme(colors: ThemeColors, themeName: ThemeName): Theme {
  return {
    dark: themeName === 'dark',
    colors: {
      primary: colors.primary,
      background: colors.background,
      card: colors.surfaceContainer,
      text: colors.onSurface,
      border: colors.outlineVariant,
      notification: colors.primary,
    },
    fonts: {
      regular: { fontFamily: fontFamilies.interRegular, fontWeight: '400' },
      medium: { fontFamily: fontFamilies.interMedium, fontWeight: '500' },
      bold: { fontFamily: fontFamilies.jakartaBold, fontWeight: '700' },
      heavy: { fontFamily: fontFamilies.jakartaBold, fontWeight: '900' },
    },
  };
}
