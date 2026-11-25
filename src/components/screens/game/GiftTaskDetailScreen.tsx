import { useLayoutEffect, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react-native';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  ButtonGhost,
  ButtonPrimary,
  spacing,
  radius,
  typography,
  states,
} from '@components/design-system';
import { JewelRequirementRow } from '@components/shared/JewelRequirementRow';
import { JewelStoreSheet } from '@components/shared/JewelStoreSheet';
import { TaskCelebrationOverlay } from '@components/shared/TaskCelebrationOverlay';
import { useGamebarStats } from '@hooks/useGamebarStats';
import { useGiftTaskElements } from '@hooks/useGiftTaskElements';
import { useGiftTaskLevel } from '@hooks/useGiftTaskLevel';
import { useWalletCounts } from '@hooks/useWalletCounts';
import { useAppSelector } from '@store/hooks';
import * as authService from '@services/authService';
import * as gameService from '@services/gameService';
import type { RootScreenProps, AppStackOptions } from '@navigation/types';

const crateIcon = require('../../../../assets/jewelbox.png');
const gemIcon = require('../../../../assets/factory.png');

const priceFormat = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const expiryFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export function GiftTaskDetailScreen({ route, navigation }: RootScreenProps<'GiftTaskDetail'>) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const wallet = useWalletCounts();
  const gamebar = useGamebarStats();
  const [jewelStoreVisible, setJewelStoreVisible] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [buyNoticeVisible, setBuyNoticeVisible] = useState(false);

  // Look up the already-fetched GiftTask (see GameScreen.tsx's card onPress)
  // rather than widening the route param — same as TaskDetailScreen.
  const giftTaskId = Number(route.params.giftTaskId);
  const giftTask = useAppSelector(
    (state) => state.giftTasks.giftTasks?.find((t) => t.id === giftTaskId) ?? null,
  );
  const elements = useGiftTaskElements(giftTask ? giftTaskId : null);
  const { record, setRecord } = useGiftTaskLevel(giftTask ? giftTaskId : null);
  const jewels = useAppSelector((state) => state.game.jewels);
  const userLevel = useAppSelector((state) => state.game.scores?.level ?? 0);

  useLayoutEffect(() => {
    const options: AppStackOptions = {
      title: 'Gift Detail',
      headerProps: {
        actions: [
          {
            key: 'crates',
            label: `${wallet.diamonds} crates`,
            image: crateIcon,
            onPress: () => setJewelStoreVisible(true),
          },
          {
            key: 'gems',
            label: `${wallet.coins} gems`,
            image: gemIcon,
            onPress: () => navigation.navigate('Factory'),
          },
        ],
        gamebar,
      },
    };
    navigation.setOptions(options);
  }, [navigation, wallet, gamebar]);

  if (!giftTask || !elements || record === undefined || record === null) {
    const message = !giftTask
      ? 'Gift not found.'
      : record === null
        ? 'Could not load this gift.'
        : 'Loading…';
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Text style={styles.notFound}>{message}</Text>
        <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
      </SafeAreaView>
    );
  }

  const jewelRows = elements.map((element) => ({
    id: element.id,
    jeweltypeId: element.jeweltype_id,
    required: element.count,
    owned: jewels?.find((j) => j.jeweltype_id === element.jeweltype_id)?.count ?? 0,
  }));
  const levelReached = userLevel >= record.level;
  const allJewelsAvailable = jewelRows.every((r) => r.owned >= r.required);
  const inStock = giftTask.current_qty > 0;
  const productLink = giftTask.productlinks?.trim();
  // The buy panel is hidden when product_value isn't a positive amount.
  const price = Number(giftTask.product_value);
  const canBuy = Number.isFinite(price) && price > 0;

  const handleRedeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      const result = await gameService.redeemGiftTask(record.id, giftTask.id);
      if (result.ok) {
        // Confirm server-side rather than assuming — also picks up giftwon_at/status.
        const confirmed = await gameService
          .checkGiftTaskCompletion(record.id, giftTask.id)
          .catch(() => null);
        setRecord(confirmed ?? { ...record, done: 1 });
        setCelebrationVisible(true);
      } else {
        setRedeemError(result.message ?? 'Could not redeem this gift. Please try again.');
      }
    } catch (err) {
      if (__DEV__) console.log('[GiftTaskDetailScreen] redeemGiftTask failed', err);
      setRedeemError('Could not redeem this gift. Check your connection and try again.');
    } finally {
      setRedeeming(false);
    }
  };

  const handleCelebrationDismiss = () => {
    setCelebrationVisible(false);
    void authService.refreshGameState();
    void gameService.refreshGiftTasks();
    navigation.goBack();
  };

  let cta;
  if (record.done) {
    cta = <ButtonGhost label="Gift won" disabled />;
  } else if (!inStock) {
    cta = <ButtonGhost label="Gift not available" disabled />;
  } else if (!levelReached) {
    cta = <ButtonGhost label={`Reach level ${record.level}`} disabled />;
  } else if (!allJewelsAvailable) {
    cta = <ButtonGhost label="Collect all jewels" disabled />;
  } else {
    cta = (
      <ButtonPrimary label="Win gift" onPress={() => void handleRedeem()} disabled={redeeming} />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.productImageWrap}>
          <Image
            source={{ uri: giftTask.product_pic }}
            style={styles.productImage}
            contentFit="contain"
          />
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productName}>{giftTask.productname}</Text>
          {giftTask.productdetail ? (
            <Text style={styles.productDetail}>{giftTask.productdetail}</Text>
          ) : null}
          {productLink ? (
            <Pressable
              style={({ pressed }) => [
                styles.linkRow,
                pressed && { opacity: states.pressedOpacity },
              ]}
              onPress={() => void Linking.openURL(productLink)}
              accessibilityRole="link"
            >
              <Text style={styles.linkText}>View product</Text>
              <ExternalLink size={16} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Reach level</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoText}>{`Level ${record.level} (you're level ${userLevel})`}</Text>
          {levelReached ? (
            <Check size={20} color={colors.success} />
          ) : (
            <X size={20} color={colors.error} />
          )}
        </View>
        <View style={styles.infoRow}>
          <Text
            style={styles.infoSubtext}
          >{`Ends ${expiryFormat.format(new Date(record.expiration_at))}`}</Text>
        </View>

        <Text style={styles.sectionTitle}>Collect jewels</Text>
        {jewelRows.map((row) => (
          <JewelRequirementRow
            key={row.id}
            jeweltypeId={row.jeweltypeId}
            required={row.required}
            owned={row.owned}
          />
        ))}

        <View style={styles.ctaWrap}>
          {redeemError ? <Text style={styles.errorText}>{redeemError}</Text> : null}
          {cta}
          {record.done && record.status ? (
            <Text style={styles.infoSubtext}>{record.status}</Text>
          ) : null}
        </View>
      </ScrollView>

      {canBuy ? (
        <View style={styles.buyPanel}>
          <View style={styles.buyPriceWrap}>
            <Text style={styles.buyPriceLabel}>Buy it from us</Text>
            <Text style={styles.buyPrice}>{priceFormat.format(price)}</Text>
            {buyNoticeVisible ? (
              <Text style={styles.infoSubtext}>Purchasing is coming soon.</Text>
            ) : null}
          </View>
          {/* Placeholder until the purchase flow/backend exists. */}
          <ButtonPrimary label="Buy it now" onPress={() => setBuyNoticeVisible(true)} />
        </View>
      ) : null}

      <JewelStoreSheet visible={jewelStoreVisible} onClose={() => setJewelStoreVisible(false)} />
      <TaskCelebrationOverlay visible={celebrationVisible} onDismiss={handleCelebrationDismiss} />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { paddingBottom: spacing.xl },
    notFound: {
      ...typography.bodyMd,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: spacing.xl,
    },
    productImageWrap: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      aspectRatio: 1.4,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.surfaceContainerHigh,
    },
    productImage: { width: '100%', height: '100%' },
    productInfo: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.xs },
    productName: { ...typography.headlineMd, color: colors.onSurface },
    productDetail: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      alignSelf: 'flex-start',
      paddingTop: spacing.xs,
    },
    linkText: { ...typography.labelLg, color: colors.primary },
    sectionTitle: {
      ...typography.labelSm,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
      paddingTop: spacing.md,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    infoText: { ...typography.bodyLg, color: colors.onSurface },
    infoSubtext: { ...typography.bodyMd, color: colors.onSurfaceVariant },
    errorText: {
      ...typography.bodyMd,
      color: colors.error,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
    buyPanel: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: colors.surfaceContainer,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
    },
    buyPriceWrap: { flexShrink: 1 },
    buyPriceLabel: {
      ...typography.labelSm,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
    },
    buyPrice: { ...typography.headlineMd, color: colors.onSurface },
    ctaWrap: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.sm },
  });
