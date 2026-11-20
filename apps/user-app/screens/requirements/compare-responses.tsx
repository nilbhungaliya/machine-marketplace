import React, { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CompareColumn } from '@mpm/shared-types';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import PriceText from '@/components/PriceText';
import ScreenWrapper from '@/components/ScreenWrapper';
import SideToken from '@/components/SideToken';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { usePartRequestCompare } from '@/hooks/use-my-part-requests';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { REQUEST_EVENTS } from '@/lib/analytics-events';
import { ArrowLeftRight, ShieldCheck, TriangleAlert } from '@/lib/icons';
import { distanceText, sideTokenKind } from '@/lib/listing-format';
import { compareRows, type CompareCell, type CompareRowKey } from '@/lib/part-request-compare';
import { formatQuantity } from '@/lib/quantity';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const LABEL_W = 104;
const COL_W = 148;

/**
 * Compare replies and matches (F8 spec §13.1, R10; mockup "Compare replies"): up to 10 listings side by side — price per
 * unit (the lowest marked), available, side, condition, distance, rating, verified — scrolling sideways beyond three
 * columns, and one button per column for that listing's contact action (Offer, Buy, Ask price, Enquire), which opens
 * the listing page with that sheet.
 */
export default function CompareResponsesScreen({ navigation, route }: RootStackScreenProps<'CompareResponses'>) {
  const { partRequestId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const compare = usePartRequestCompare(partRequestId);
  const columns = compare.data?.columns ?? [];

  useEffect(() => {
    if (compare.data) track(REQUEST_EVENTS.requestCompareOpened, { columns: compare.data.columns.length });
  }, [!!compare.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
    table: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, overflow: 'hidden' },
    row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider },
    rowLast: { borderBottomWidth: 0 },
    labelCell: { width: LABEL_W, padding: spacing.md, justifyContent: 'center', backgroundColor: colors.field },
    label: { ...type('label'), color: colors.textMuted },
    cell: { width: COL_W, padding: spacing.md, justifyContent: 'center', gap: spacing.xs },
    title: { ...type('bodyStrong'), color: colors.text },
    source: { ...type('caption'), color: colors.textMuted },
    value: { ...type('body'), color: colors.text },
    muted: { ...type('body'), color: colors.textMuted },
    lowest: { backgroundColor: colors.okSoft },
    skeleton: { height: 320, borderRadius: radius.xl },
  }), [colors, type]);

  const cellText = (cell: CompareCell): React.ReactNode => {
    switch (cell.row) {
      case 'price':
        if (cell.onRequest || cell.paise === null) return <Text style={s.muted}>{t('requirements.compare.priceOnRequest')}</Text>;
        return (
          <>
            <PriceText paise={cell.paise} />
            {cell.lowest ? <StatusChip tone="ok" label={t('requirements.compare.lowest')} /> : null}
          </>
        );
      case 'available':
        return cell.quantity === null
          ? <Text style={s.muted}>—</Text>
          : <Text style={s.value}>{`${formatQuantity(cell.quantity)} ${cell.unitLabel ?? ''}`.trim()}</Text>;
      case 'side': {
        const kind = cell.side ? sideTokenKind(cell.side) : null;
        return kind ? <SideToken kind={kind} size="md" /> : <Text style={s.muted}>—</Text>;
      }
      case 'condition':
        return <Text style={cell.label ? s.value : s.muted}>{cell.label ?? '—'}</Text>;
      case 'distance':
        return <Text style={cell.km === null ? s.muted : s.value}>{cell.km === null ? '—' : distanceText(cell.km)}</Text>;
      case 'rating':
        return cell.stars === null
          ? <Text style={s.muted}>{t('requirements.compare.noRating')}</Text>
          : <Text style={s.value}>{t('requirements.compare.rating', { stars: cell.stars.toFixed(1), count: cell.reviews })}</Text>;
      case 'verified':
        return cell.verified
          ? <StatusChip tone="ok" icon={ShieldCheck} label={t('requirements.reply.verified')} />
          : <Text style={s.muted}>{t('requirements.compare.notVerified')}</Text>;
    }
  };

  const action = (c: CompareColumn) => t(`requirements.compare.action.${c.contactAction}`);

  let body: React.ReactNode;
  if (compare.isLoading) {
    body = <Skeleton style={s.skeleton} />;
  } else if (compare.isError) {
    body = (
      <EmptyState
        icon={TriangleAlert}
        title={t('requirements.loadErrorTitle')}
        subtitle={t('requirements.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Compare-retry"
        onCtaPress={() => void compare.refetch()}
      />
    );
  } else if (columns.length === 0) {
    body = <EmptyState icon={ArrowLeftRight} title={t('requirements.compare.emptyTitle')} subtitle={t('requirements.compare.emptyBody')} />;
  } else {
    const rows = compareRows(columns);
    body = (
      <ScrollView horizontal showsHorizontalScrollIndicator={columns.length > 3} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={s.table}>
          <View style={s.row}>
            <View style={s.labelCell} />
            {columns.map((c) => (
              <View key={c.listingId} style={s.cell}>
                <Text style={s.title} numberOfLines={3}>{c.title}</Text>
                <Text style={s.source}>{t(`requirements.compare.source.${c.source}`)}</Text>
              </View>
            ))}
          </View>
          {rows.map((r) => (
            <View key={r.key} style={s.row}>
              <View style={s.labelCell}><Text style={s.label}>{t(`requirements.compare.row.${r.key as CompareRowKey}`)}</Text></View>
              {r.cells.map((cell, i) => (
                <View key={columns[i]!.listingId} style={[s.cell, cell.row === 'price' && cell.lowest && s.lowest]}>{cellText(cell)}</View>
              ))}
            </View>
          ))}
          <View style={[s.row, s.rowLast]}>
            <View style={s.labelCell} />
            {columns.map((c) => (
              <View key={c.listingId} style={s.cell}>
                <Button
                  title={action(c)}
                  size="sm"
                  variant={c.contactAction === 'buy' || c.contactAction === 'offer' ? 'primary' : 'outline'}
                  phLabel={`Compare-action-${c.contactAction}`}
                  onPress={() => navigation.navigate('Listing', { listingId: c.listingId, openSheet: c.contactAction })}
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScreenWrapper scroll>
      <Header title={t('requirements.compare.title', { count: columns.length })} />
      <View style={s.body} testID="CompareResponses-screen">{body}</View>
    </ScreenWrapper>
  );
}
