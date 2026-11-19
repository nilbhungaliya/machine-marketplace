import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { MapPin, Package } from '@/lib/icons';
import type { SideKind } from '@/lib/side-token';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import SideToken from '@/components/SideToken';
import StatusChip, { type StatusTone } from '@/components/StatusChip';

interface ListingCardProps {
  title: string;
  thumbUrl: string | null;
  /** The part's side token; omit (or `none`) for no side. */
  side?: SideKind | null;
  /** Translated labels (`lib/listing-format.ts`). */
  condition?: string;
  quantity?: string;
  /** The price line in the card's pill: `PriceText` or any node (e.g. a rate). */
  price?: React.ReactNode;
  /** Bottom line: place and distance ("Aji GIDC, Rajkot · 2 km away"), or "Updated 3 days ago" on My listings. */
  subtitle?: string;
  /** Shows a pin before the subtitle (a place). */
  subtitleIsPlace?: boolean;
  /** My listings' status. */
  status?: { label: string; tone: StatusTone } | null;
  /** The yellow tag above the title ("Possibly the other side", "Still available?"). */
  tag?: string;
  /** Translated card tags (F4 + F5 §4.7: "Reserved", "On rent", "Pair: contains a left"), yellow, after `tag`. */
  tags?: string[];
  /** The heart (`SaveButton`), drawn on the thumbnail's top-right corner. */
  heart?: React.ReactNode;
  /** A one-line nudge or message under the card body ("Add a video", the moderator's note). */
  nudge?: string;
  /** Extra content under the body (a Renew banner, buttons). */
  children?: React.ReactNode;
  onPress?: () => void;
  testID: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A listing row (v2 `.listing`, F2 spec §15.2): thumbnail, title, side, condition, quantity, price, place. F4 + F5
 * (§8.6) adds the heart on the thumbnail and the card tags; the distance is in the place line ("Under 2 km away").
 */
export default function ListingCard({
  title, thumbUrl, side, condition, quantity, price, subtitle, subtitleIsPlace = false, status, tag, tags, heart, nudge,
  children, onPress, testID, accessibilityLabel, style,
}: ListingCardProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg + 2, borderWidth: 1, borderColor: colors.hairline,
      padding: spacing.sm, gap: spacing.sm,
    },
    row: { flexDirection: 'row', gap: spacing.md },
    thumb: {
      width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    heart: { position: 'absolute', top: 4, right: 4 },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    body: { flex: 1, minWidth: 0, gap: spacing.xs, paddingVertical: 2, paddingRight: spacing.xs },
    tag: {
      ...type('badge'), alignSelf: 'flex-start', color: colors.onSun, backgroundColor: colors.sun, borderRadius: radius.full,
      paddingHorizontal: spacing.sm, overflow: 'hidden',
    },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    title: { ...type('cardTitle'), color: colors.text, flex: 1 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs + 2 },
    pill: {
      ...type('badge'), color: colors.textSecondary, backgroundColor: colors.background, borderWidth: 1,
      borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.sm, overflow: 'hidden',
    },
    foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    place: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
    placeText: { ...type('caption'), color: colors.textMuted, flexShrink: 1 },
    nudge: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const body = (
    <View style={s.row}>
      <View style={s.thumb}>
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={s.image} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Package size={32} color={colors.textMuted} />
        )}
        {heart ? <View style={s.heart}>{heart}</View> : null}
      </View>
      <View style={s.body}>
        {tag || tags?.length ? (
          <View style={s.tagRow}>
            {[...(tag ? [tag] : []), ...(tags ?? [])].map((label, i) => (
              // Two tags can translate to the same text: keyed by position.
              <Text key={i} style={s.tag} numberOfLines={1}>{label}</Text>
            ))}
          </View>
        ) : null}
        <View style={s.titleRow}>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          {status ? <StatusChip label={status.label} tone={status.tone} /> : null}
        </View>
        {(side && side !== 'none') || condition || quantity ? (
          <View style={s.tags}>
            {side && side !== 'none' ? <SideToken kind={side} /> : null}
            {condition ? <Text style={s.pill}>{condition}</Text> : null}
            {quantity ? <Text style={s.pill}>{quantity}</Text> : null}
          </View>
        ) : null}
        {price || subtitle ? (
          <View style={s.foot}>
            {price ?? null}
            {subtitle ? (
              <View style={s.place}>
                {subtitleIsPlace ? <MapPin size={13} color={colors.textMuted} /> : null}
                <Text style={s.placeText} numberOfLines={1}>{subtitle}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <Pressable
      style={[s.card, style]}
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {body}
      {nudge ? <Text style={s.nudge}>{nudge}</Text> : null}
      {children}
    </Pressable>
  );
}
