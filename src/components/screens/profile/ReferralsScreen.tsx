import { useLayoutEffect } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, useStyles, useThemeColors, type ThemeColors, spacing, radius, typography } from '@components/design-system';
import { useReferrals } from '@hooks/useReferrals';
import { initialsFor } from '../../../utils/initials';
import type { RootScreenProps } from '@navigation/types';
import type { Child } from '@app-types/game';

/** Pushed from the Profile tab's "Referrals" quick-action tile. Lists every user this account has referred, 100/page — see useReferrals.ts. */
export function ReferralsScreen({ navigation }: RootScreenProps<'Referrals'>) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const { referrals, loading, loadingMore, hasMore, loadMore } = useReferrals();

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Referrals' });
  }, [navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={referrals}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ReferralRow child={item} styles={styles} colors={colors} />}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No referrals yet.</Text>
          </View>
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null}
      />
    </SafeAreaView>
  );
}

function ReferralRow({
  child,
  styles,
  colors,
}: {
  child: Child;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.row}>
      <Avatar initials={initialsFor(child.name)} size={48} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {child.name}
        </Text>
        <Text style={styles.phone} numberOfLines={1}>
          {child.phone}
        </Text>
      </View>
      <View style={styles.levelPill}>
        <Text style={styles.levelText}>{`Lvl ${child.level}`}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    footer: { paddingVertical: spacing.lg },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
    },
    body: { flex: 1, gap: 2 },
    name: { ...typography.bodyLg, color: colors.onSurface },
    phone: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    levelPill: {
      backgroundColor: colors.primaryContainer,
      borderRadius: radius.xl,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    levelText: { ...typography.labelSm, color: colors.onPrimaryContainer },
  });
