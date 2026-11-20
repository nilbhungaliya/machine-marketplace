import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Condition, PartSide, SellerPartRequestRow } from '@mpm/shared-types';
import Button from '@/components/Button';
import PressableScale from '@/components/PressableScale';
import SideToken from '@/components/SideToken';
import StatusChip from '@/components/StatusChip';
import BuyerBlock from '@/components/part-requests/BuyerBlock';
import { useMasterData } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { i18n } from '@/lib/i18n';
import { ClipboardList, Send } from '@/lib/icons';
import { conditionLabel, distanceText } from '@/lib/listing-format';
import { formatDayMonth } from '@/lib/format-date';
import { formatRupees } from '@/lib/money';
import { daysLeftKey } from '@/lib/part-request-display';
import { formatQuantity } from '@/lib/quantity';
import type { SideKind } from '@/lib/side-token';
import { radius, spacing, useTheme } from '@/lib/theme';

// Display lines a seller reads on a request (F8 spec §12.3), shared by the row, Home's strip and the seller's
// requirement page. Copy from `buyers.json` and `listing.json` at call time.

/** The side token of what the buyer wants: a "want" half for Left / Right, the pair for Pair, none otherwise. */
export function requestSideKind(side: PartSide | null): SideKind | null {
  if (side === 'left') return 'want-left';
  if (side === 'right') return 'want-right';
  if (side === 'pair') return 'pair';
  return null;
}

/** "Left side · 6 pcs · Mahindra 575 DI". */
export function requestSummary(r: { side: PartSide | null; quantity: string; unitLabel: string; firstFit: string | null }): string {
  const side = r.side === 'left' || r.side === 'right' || r.side === 'pair' ? i18n.t(`listing.side.${r.side}`) : null;
  const qty = `${formatQuantity(r.quantity)} ${r.unitLabel}`.trim();
  return [side, qty, r.firstFit].filter(Boolean).join(' · ');
}

/** "Budget ₹1,200 a unit", or "Budget private" when the buyer keeps it to themselves (the API sends null). */
export function budgetText(paise: number | null): string {
  return paise == null ? i18n.t('buyers.row.budgetPrivate') : i18n.t('buyers.row.budget', { price: formatRupees(paise) });
}

/** "New, Unused" from the master data; "Any condition" when the request takes every condition. */
export function conditionsText(ids: readonly string[], conditions: readonly Condition[] | undefined): string {
  if (ids.length === 0) return i18n.t('buyers.row.anyCondition');
  const labels = ids
    .map((id) => conditions?.find((c) => c.id === id))
    .filter((c): c is Condition => !!c)
    .map((c) => conditionLabel(c));
  return labels.length > 0 ? labels.join(', ') : i18n.t('buyers.row.someConditions', { count: ids.length });
}

/** "Needed by 22 Nov" (an IST date, `YYYY-MM-DD`); '' without one. */
export function neededByText(neededBy: string | null): string {
  if (!neededBy) return '';
  const ms = Date.parse(`${neededBy}T12:00:00+05:30`);
  return Number.isNaN(ms) ? '' : i18n.t('buyers.row.neededBy', { date: formatDayMonth(ms) });
}

/** "Wankaner · 38 km away"; "Outside their area" is added by the caller. */
export function placeLine(city: string | null, distanceKm: number | null): string {
  return [city, distanceText(distanceKm)].filter(Boolean).join(' · ');
}

interface SellerRequestRowProps {
  row: SellerPartRequestRow;
  onPress: () => void;
  /** "Reply" (Buyers looking); omitted on Home's compact strip. */
  onReply?: () => void;
  /** Home's strip: name, summary and place only. */
  compact?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A row of "Buyers looking for your parts" (F8 spec §12.3, §13.1; mockup requirements · "Seller sees a requirement"):
 * the wanted side, name, side + quantity + first fit, conditions, budget or "Private", needed by + Urgent, days left,
 * city + km, the buyer block, how many sellers replied, and Reply.
 */
export default function SellerRequestRow({ row, onPress, onReply, compact = false, testID, style }: SellerRequestRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const master = useMasterData();
  const s = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline,
      padding: spacing.md, gap: spacing.sm,
    },
    top: { flexDirection: 'row', gap: spacing.md },
    lead: { width: 44, alignItems: 'center', paddingTop: 2 },
    well: {
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryWash, alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    title: { ...type('cardTitle'), color: colors.text },
    line: { ...type('caption'), color: colors.textSecondary },
    muted: { ...type('caption'), color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
    foot: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
      borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm,
    },
    footText: { flex: 1, gap: 2 },
  }), [colors, type]);

  const sideKind = requestSideKind(row.side);
  const days = daysLeftKey(row.daysLeft);
  const place = [placeLine(row.city, row.distanceKm), row.inReach ? '' : t('buyers.row.outsideReach')].filter(Boolean).join(' · ');
  const when = [neededByText(row.neededBy), t(days.key, days.count !== undefined ? { count: days.count } : {})]
    .filter(Boolean).join(' · ');

  return (
    <PressableScale onPress={onPress} style={[s.card, style]} testID={testID} accessibilityRole="button">
      <View style={s.top}>
        <View style={s.lead}>
          {sideKind ? <SideToken kind={sideKind} size="lg" /> : (
            <View style={s.well}><ClipboardList size={20} color={colors.primaryInk} /></View>
          )}
        </View>
        <View style={s.body}>
          <Text style={s.title} numberOfLines={2}>{row.name}</Text>
          <Text style={s.line} numberOfLines={1}>{requestSummary(row)}</Text>
          {!compact ? (
            <Text style={s.line} numberOfLines={1}>
              {[conditionsText(row.conditionIds, master.data?.conditions), budgetText(row.budgetPerUnitPaise)].join(' · ')}
            </Text>
          ) : null}
          {place ? <Text style={s.line} numberOfLines={1}>{place}</Text> : null}
          {!compact ? <Text style={s.muted} numberOfLines={1}>{when}</Text> : null}
          <View style={s.chips}>
            {row.urgent ? <StatusChip label={t('buyers.row.urgent')} tone="danger" /> : null}
            {row.targeted ? <StatusChip label={t('buyers.row.forYou')} tone="sun" /> : null}
            {row.hasMatchingStock ? <StatusChip label={t('buyers.row.youHaveStock')} tone="ok" /> : null}
            {row.myReplyCount > 0 ? (
              <StatusChip label={t('buyers.row.youReplied', { count: row.myReplyCount })} tone="info" />
            ) : null}
          </View>
        </View>
      </View>
      {!compact ? (
        <View style={s.foot}>
          <View style={s.footText}>
            <BuyerBlock buyer={row.buyer} compact />
            <Text style={s.muted} numberOfLines={1}>
              {row.replyCount > 0 ? t('buyers.row.replies', { count: row.replyCount }) : t('buyers.row.noReplies')}
            </Text>
          </View>
          {onReply ? (
            <Button title={t('buyers.row.reply')} size="sm" icon={Send} onPress={onReply} phLabel={`${testID}-reply`} />
          ) : null}
        </View>
      ) : null}
    </PressableScale>
  );
}
