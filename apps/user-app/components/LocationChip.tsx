import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DiscoveryRadiusKm } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { ChevronDown, MapPin } from '@/lib/icons';
import { radiusLabel } from '@/lib/search-filters';
import { spacing, useTheme } from '@/lib/theme';

interface LocationChipProps {
  /** The server's `origin.label` (area and city); null before the first answer or with no origin. */
  label: string | null;
  /** No origin at all (no permission, no business, no pincode): "All India", no radius line. */
  allIndia: boolean;
  radiusKm: DiscoveryRadiusKm | null;
  /** While the first GPS fix is on its way. */
  locating?: boolean;
  onPress: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Home's location chip (v2 `.loc`, F4 + F5 spec §8.2): pin, the origin's label in bold, "Within 50 km" / "All India"
 * under it, a chevron; opens the location sheet. Never shows coordinates or a pincode the server didn't echo.
 */
export default function LocationChip({ label, allIndia, radiusKm, locating = false, onPress, testID, style }: LocationChipProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, flexShrink: 1 },
    text: { flexShrink: 1 },
    label: { ...type('bodyStrong'), color: colors.text },
    radius: { ...type('caption'), color: colors.textMuted },
  }), [colors, type]);

  const radius = radiusLabel(radiusKm);
  const radiusText = t(radius.key, radius.params);
  const title = allIndia
    ? t('discover.radius.allIndia')
    : label ?? (locating ? t('discover.location.locating') : t('discover.location.nearYou'));
  const sub = allIndia ? null : radiusText;

  return (
    <Pressable
      style={[s.chip, style]}
      onPress={onPress}
      testID={testID ?? 'Location-chip'}
      accessibilityRole="button"
      accessibilityLabel={allIndia ? t('discover.location.chipA11yAllIndia') : t('discover.location.chipA11y', { label: title, radius: radiusText })}
    >
      <MapPin size={20} color={colors.primaryInk} />
      <View style={s.text}>
        <Text style={s.label} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.radius} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <ChevronDown size={18} color={colors.textMuted} />
    </Pressable>
  );
}
