import React, { useMemo } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSaveToggle } from '@/hooks/use-saved';
import { Heart } from '@/lib/icons';
import { radius, useTheme } from '@/lib/theme';

interface SaveButtonProps {
  listingId: string;
  /** The card's `saved` (null for a guest: the heart is empty and asks to sign in). */
  saved: boolean | null;
  /** `sm` 28 (on a photo, v2 `.hrt`) · `md` 44 (a header). */
  size?: 'sm' | 'md';
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The heart (v2 `.hrt`, F4 + F5 spec §8.5): white circle with a violet outline heart; saved = violet circle with a
 * filled white heart. Optimistic through `useSaveToggle`; a guest gets the sign-in sheet and the save finishes after
 * sign-in. Never shown on the viewer's own listing (`canShowHeart`, the caller decides).
 */
export default function SaveButton({ listingId, saved, size = 'sm', testID, style }: SaveButtonProps) {
  const { t } = useTranslation();
  const { colors, shadows } = useTheme();
  const toggle = useSaveToggle();
  const on = saved === true;
  const box = size === 'sm' ? 28 : 44;

  const s = useMemo(() => StyleSheet.create({
    button: {
      width: box, height: box, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface, ...shadows.raised,
    },
    on: { backgroundColor: colors.primary },
  }), [box, colors, shadows]);

  return (
    <Pressable
      style={[s.button, on && s.on, style]}
      onPress={() => void toggle(listingId, saved)}
      // A 28 dp circle on a photo: the slop makes the target 44.
      hitSlop={size === 'sm' ? 8 : 0}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={on ? t('discover.save.remove') : t('discover.save.add')}
      accessibilityState={{ selected: on }}
    >
      <Heart
        size={size === 'sm' ? 15 : 20}
        color={on ? colors.onPrimary : colors.primary}
        fill={on ? colors.onPrimary : 'transparent'}
      />
    </Pressable>
  );
}
