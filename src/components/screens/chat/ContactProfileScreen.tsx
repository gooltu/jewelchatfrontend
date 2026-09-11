import { useLayoutEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStyles, type ThemeColors, spacing, typography } from '@components/design-system';
import { ContactAvatar } from '@components/shared/ContactAvatar';
import type { RootScreenProps } from '@navigation/types';

/** Minimal stub for a phonebook contact with no JewelChat account — no chat/call actions. */
export function ContactProfileScreen({ route, navigation }: RootScreenProps<'ContactProfile'>) {
  const { name, phone } = route.params;
  const styles = useStyles(makeStyles);

  useLayoutEffect(() => {
    navigation.setOptions({ title: name ?? 'Contact' });
  }, [navigation, name]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.body}>
        <ContactAvatar jid={null} name={name} size={96} />
        <Text style={[typography.headlineMd, styles.name]}>{name ?? 'Unknown'}</Text>
        {phone != null && <Text style={[typography.bodyMd, styles.phone]}>{phone}</Text>}
        <Text style={[typography.bodyMd, styles.status]}>Not on Jewel Chat yet</Text>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    body: { flex: 1, alignItems: 'center', paddingTop: spacing.xl, gap: spacing.xs },
    name: { color: colors.onSurface, marginTop: spacing.sm },
    phone: { color: colors.onSurfaceVariant },
    status: { color: colors.onSurfaceVariant, marginTop: spacing.md },
  });
