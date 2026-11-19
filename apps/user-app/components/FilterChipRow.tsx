import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Chip from '@/components/Chip';
import { useType } from '@/hooks/use-type';
import { X, type LucideIcon } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface FilterChipItem {
  /** Stable key in the row. */
  id: string;
  /** Translated (or catalogue text as the admin typed it). */
  label: string;
  /** Lavender: an applied filter, the reader's chip. */
  selected?: boolean;
  icon?: LucideIcon;
  onPress?: () => void;
  /** Shows a × that removes the chip (the query reader's chips, R8). */
  onRemove?: () => void;
  testID: string;
}

interface FilterChipRowProps {
  items: FilterChipItem[];
  style?: StyleProp<ViewStyle>;
}

/**
 * The results screen's filter row (v2 `.filterrow`, F4 + F5 spec §8.4): one horizontal line of chips — Filters n, the
 * reader's removable chips, the radius chip, quick chips. Plain chips are the kit's `Chip`; a removable chip adds a ×
 * with its own target ("Remove …").
 */
export default function FilterChipRow({ items, style }: FilterChipRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.sm, alignItems: 'center' },
    removable: {
      flexDirection: 'row', alignItems: 'center', minHeight: 40, borderRadius: radius.full,
      backgroundColor: colors.primarySoft, paddingLeft: 14,
    },
    body: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40 },
    label: { ...type('chip'), color: colors.primaryInk },
    remove: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  }), [colors, type]);

  return (
    <View style={style}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} keyboardShouldPersistTaps="handled">
        {items.map((item) => {
          if (!item.onRemove) {
            return (
              <Chip
                key={item.id}
                label={item.label}
                icon={item.icon}
                selected={item.selected}
                onPress={item.onPress}
                testID={item.testID}
                role="button"
              />
            );
          }
          const Icon = item.icon;
          return (
            <View key={item.id} style={s.removable}>
              <Pressable
                style={s.body}
                onPress={item.onPress}
                disabled={!item.onPress}
                testID={item.testID}
                accessibilityRole="button"
              >
                {Icon ? <Icon size={16} color={colors.primaryInk} /> : null}
                <Text style={s.label} numberOfLines={1}>{item.label}</Text>
              </Pressable>
              <Pressable
                style={s.remove}
                onPress={item.onRemove}
                hitSlop={4}
                testID={`${item.testID}-remove`}
                accessibilityRole="button"
                accessibilityLabel={t('discover.chips.remove', { label: item.label })}
              >
                <X size={16} color={colors.primaryInk} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
