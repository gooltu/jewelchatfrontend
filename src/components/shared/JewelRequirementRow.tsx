import { Check, Info, X } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import {
  useStyles,
  useThemeColors,
  type ThemeColors,
  spacing,
  typography,
  SVGImageIcon,
} from '@components/design-system';
import { resolveJewelIcon } from '@app-types/game';

interface JewelRequirementRowProps {
  jeweltypeId: number;
  required: number;
  owned: number;
}

/**
 * One "Collect jewels" row on TaskDetailScreen/GiftTaskDetailScreen: up to
 * three copies of the jewel's icon (plus the full count when it's large),
 * and a check/cross for whether the user owns enough. Icons go through
 * resolveJewelIcon, since gift requirements can include diamonds
 * (jeweltype_id 0), not just the pickable j3-j17 range.
 */
export function JewelRequirementRow({ jeweltypeId, required, owned }: JewelRequirementRowProps) {
  const styles = useStyles(makeStyles);
  const colors = useThemeColors();
  const icon = resolveJewelIcon(jeweltypeId);
  const available = owned >= required;
  const shown = Math.min(required, 3);

  return (
    <View style={styles.row}>
      <View style={styles.icons}>
        {icon ? (
          Array.from({ length: shown }).map((_, index) => (
            <SVGImageIcon key={index} icon={icon} size={28} />
          ))
        ) : (
          <Text style={styles.count}>{`${required}`}</Text>
        )}
        {icon && required > 5 && <Text style={styles.count}>{`...(${required})`}</Text>}
      </View>
      {available ? (
        <Check size={20} color={colors.success} />
      ) : (
        <View style={styles.status}>
          <X size={20} color={colors.error} />
          <Info size={20} color={colors.onSurfaceVariant} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    icons: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
    count: { ...typography.bodyLg, color: colors.primary },
    status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  });
