import { useLayoutEffect } from 'react';
import { Users } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Strophe } from 'react-native-strophe';
import {
  Avatar,
  SVGImageIcon,
  useStyles,
  useThemeColors,
  type ThemeColors,
  spacing,
  typography,
} from '@components/design-system';
import { useAvatarSource } from '@hooks/useAvatarSource';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useUserProfile } from '@hooks/useUserProfile';
import { initialsFor } from '../../../utils/initials';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';

/** gameserver jeweltype_id convention for this endpoint's response: 0 = diamonds, 1 = coins, 2 = referral count. */
const JEWEL_TYPE_DIAMONDS = 0;
const JEWEL_TYPE_COINS = 1;
const JEWEL_TYPE_REFERRALS = 2;

export function ProfileDetailScreen({ route, navigation }: RootScreenProps<'ProfileDetail'>) {
  const { chatRoomJid, title } = route.params;
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const userId = Number(Strophe.getNodeFromJid(chatRoomJid));
  const { user, jewels, loading } = useUserProfile(Number.isFinite(userId) ? userId : null);
  const avatarSource = useAvatarSource(chatRoomJid);
  const gamebar = useGamebarStats();

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: user?.name ?? title,
      headerProps: { gamebar },
    };
    navigation.setOptions(options);
  }, [navigation, user, title, gamebar]);

  const countFor = (jeweltypeId: number) => jewels.find((j) => j.jeweltype_id === jeweltypeId)?.count ?? 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.body}>
        <Avatar source={avatarSource} initials={initialsFor(user?.name ?? title)} size={128} />
        <Text style={[typography.headlineMd, styles.name]}>{user?.name ?? title}</Text>
        {loading ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <>
            {user?.phone != null && <Text style={[typography.bodyMd, styles.phone]}>{user.phone}</Text>}
            {user?.status != null && <Text style={[typography.bodyMd, styles.status]}>{user.status}</Text>}
            {user?.level != null && (
              <Text style={[typography.bodyMd, styles.status]}>{`Level ${user.level}`}</Text>
            )}

            <View style={styles.statRow}>
              <View style={styles.statPill}>
                <SVGImageIcon icon="diamond" size={22} />
                <Text style={styles.statValue}>{countFor(JEWEL_TYPE_DIAMONDS)}</Text>
              </View>
              <View style={styles.statPill}>
                <SVGImageIcon icon="coin" size={22} />
                <Text style={styles.statValue}>{countFor(JEWEL_TYPE_COINS)}</Text>
              </View>
              <View style={styles.statPill}>
                <Users size={22} color={colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.statValue}>{countFor(JEWEL_TYPE_REFERRALS)}</Text>
              </View>
            </View>
          </>
        )}
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
    status: { color: colors.onSurfaceVariant },
    loading: { marginTop: spacing.lg },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      width: '100%',
      marginTop: spacing.lg,
    },
    statPill: { alignItems: 'center', gap: spacing.xs },
    statValue: { ...typography.bodyLg, color: colors.onSurface },
  });
