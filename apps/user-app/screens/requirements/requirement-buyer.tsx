import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { PART_REQUEST_LIMITS, type PartRequestBuyerView, type PartRequestMatchItem, type PartRequestReplyItem } from '@mpm/shared-types';
import ActionSheet, { type ActionSheetItem } from '@/components/ActionSheet';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import IconButton from '@/components/IconButton';
import Notice from '@/components/Notice';
import SegmentedControl from '@/components/SegmentedControl';
import SideToken from '@/components/SideToken';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import CloseSheet from '@/components/part-requests/CloseSheet';
import FulfilBanner from '@/components/part-requests/FulfilBanner';
import MatchCard from '@/components/part-requests/MatchCard';
import RenewSheet from '@/components/part-requests/RenewSheet';
import ReplyCard from '@/components/part-requests/ReplyCard';
import FitText from '@/components/part-requests/form/FitText';
import { useMarkRequestRead, usePartRequestMatches, usePartRequestReplies, useRequestAction } from '@/hooks/use-my-part-requests';
import { usePartRequestOptions } from '@/hooks/use-part-request';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { REQUEST_EVENTS } from '@/lib/analytics-events';
import { f8ErrorMessage } from '@/lib/f8-errors';
import { formatDayMonth } from '@/lib/format-date';
import { ArrowLeftRight, BellRing, EllipsisVertical, Inbox, Info, Package, RefreshCw } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import { daysLeftKey, requestStatusKey, requestStatusTone } from '@/lib/part-request-display';
import { copyOf } from '@/lib/part-request-form';
import { formatQuantity } from '@/lib/quantity';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

export interface RequirementBuyerProps {
  request: PartRequestBuyerView;
  /** The tab a notification asked for (`replies` / `matches`); the buyer view only. */
  tab?: 'replies' | 'matches';
}

type Tab = 'replies' | 'matches';
type Item = { type: 'reply'; item: PartRequestReplyItem } | { type: 'match'; item: PartRequestMatchItem };

/**
 * The buyer's own requirement (F8 spec §13.1, R10; mockup "Replies and matches"): the header (name, side wanted,
 * quantity, fits, status, Matched, "Sent to n sellers", days left), the fulfil prompt, the details, segments Replies n /
 * Auto matches n with cards that open the listing page, "Compare n", and the menu (Edit, Renew, Mark fulfilled, Close,
 * Post again). Opening it — and every live update with something new — marks its notifications read and its replies
 * seen (`POST …/read`).
 */
export default function RequirementBuyer({ request, tab: initialTab }: RequirementBuyerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const options = usePartRequestOptions();
  const [tab, setTab] = useState<Tab>(initialTab ?? (request.counts.replies === 0 && request.counts.matches > 0 ? 'matches' : 'replies'));
  const [sheet, setSheet] = useState<'menu' | 'close' | 'renew' | null>(null);
  const replies = usePartRequestReplies(request.id);
  const matches = usePartRequestMatches(request.id);
  const action = useRequestAction(request.id);
  const read = useMarkRequestRead();

  // `read` on open, and again when a live update (`part_request:updated`) brings something new.
  const newTotal = request.counts.newReplies + request.counts.newMatches;
  const lastRead = useRef<number | null>(null);
  useEffect(() => {
    // The view isn't refetched by `read`, so after it the server's count restarts from 0 while ours still shows the
    // opening count: any change to a non-zero count is something new.
    const prev = lastRead.current;
    lastRead.current = newTotal;
    if (prev === null || (newTotal > 0 && newTotal !== prev)) read.mutate(request.id);
  }, [request.id, newTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = request.status === 'active';
  const part = request.kind === 'part';

  const s = useMemo(() => StyleSheet.create({
    flex: { flex: 1 },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
    head: { gap: spacing.md, paddingBottom: spacing.xs },
    top: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    well: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.photo, alignItems: 'center', justifyContent: 'center' },
    topText: { flex: 1, gap: spacing.xs },
    name: { ...type('title'), color: colors.text },
    sub: { ...type('body'), color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    meta: { ...type('caption'), color: colors.textMuted },
    row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
    label: { ...type('label'), color: colors.textMuted, width: 112 },
    value: { ...type('body'), color: colors.text, flex: 1 },
    mono: { ...type('mono'), color: colors.text, flex: 1 },
    note: { ...type('body'), color: colors.textSecondary },
    skeleton: { height: 112, borderRadius: radius.xl },
  }), [colors, type]);

  // ─── Actions ───
  const run = (a: Parameters<typeof action.mutate>[0], done: () => void) => {
    action.mutate(a, {
      onSuccess: () => {
        setSheet(null);
        done();
      },
      onError: (err) => Toast.show({ type: 'error', text1: f8ErrorMessage(err) }),
    });
  };
  const fulfil = (dealId: string | null) => run({ type: 'fulfil', dealId }, () => {
    track(REQUEST_EVENTS.requestFulfilled, { fromPrompt: dealId !== null });
    Toast.show({ type: 'success', text1: t('requirements.toast.fulfilled') });
  });

  const menuItems: ActionSheetItem[] = [];
  if (active) menuItems.push({ key: 'edit', label: t('requirements.menu.edit'), testID: 'Requirement-menu-edit' });
  if (active || request.status === 'expired') menuItems.push({ key: 'renew', label: t('requirements.menu.renew'), testID: 'Requirement-menu-renew' });
  if (active) menuItems.push({ key: 'fulfil', label: t('requirements.menu.fulfil'), testID: 'Requirement-menu-fulfil' });
  if (active) menuItems.push({ key: 'close', label: t('requirements.menu.close'), destructive: true, testID: 'Requirement-menu-close' });
  if (request.status === 'closed' || request.status === 'expired' || request.status === 'fulfilled') {
    menuItems.push({ key: 'copy', label: t('requirements.menu.postAgain'), testID: 'Requirement-menu-post-again' });
  }

  const onMenu = (key: string) => {
    setSheet(null);
    if (key === 'edit') navigation.navigate('PostRequirement', { editId: request.id });
    else if (key === 'renew') setTimeout(() => setSheet('renew'), 250);
    else if (key === 'close') setTimeout(() => setSheet('close'), 250);
    else if (key === 'fulfil') fulfil(request.fulfilPrompt?.dealId ?? null);
    else if (key === 'copy') navigation.navigate('PostRequirement', { prefill: copyOf(request) });
  };

  // ─── Header ───
  const sideKind = request.side === 'left' ? 'want-left' : request.side === 'right' ? 'want-right' : request.side === 'pair' ? 'pair' : null;
  const sub = [
    request.side && request.side !== 'not_applicable' ? t(`requirements.form.sideOption.${request.side}`) : null,
    part ? `${formatQuantity(request.quantity)} ${request.unit.label}` : null,
  ].filter(Boolean).join(', ');
  const days = daysLeftKey(request.daysLeft);
  const reachText = request.reach === 'state' ? (request.state ?? t('requirements.form.reach.stateFallback'))
    : request.reach === 'all_india' ? t('requirements.form.reach.allIndia')
      : t('requirements.form.reach.km', { km: request.reach === 'radius_50' ? 50 : 200 });

  const detail = (label: string, value: React.ReactNode, mono = false) => (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      {typeof value === 'string' ? <Text style={mono ? s.mono : s.value}>{value}</Text> : <View style={s.flex}>{value}</View>}
    </View>
  );

  const statusNotice = request.status === 'expired' ? 'expired' : request.status === 'closed' ? 'closed' : request.status === 'fulfilled' ? 'fulfilled' : request.status === 'removed' ? 'removed' : null;

  const compareCount = Math.min(request.counts.replies + request.counts.matches, PART_REQUEST_LIMITS.compareMax);
  const replyItems = replies.data?.items ?? [];
  const matchItems = matches.data?.items ?? [];
  const query = tab === 'replies' ? replies : matches;
  const data: Item[] = tab === 'replies'
    ? replyItems.map((item) => ({ type: 'reply' as const, item }))
    : matchItems.map((item) => ({ type: 'match' as const, item }));

  const header = (
    <View style={s.head}>
      <Card style={{ gap: spacing.md }}>
        <View style={s.top}>
          {sideKind ? <SideToken kind={sideKind} size="xl" /> : <View style={s.well}><Package size={24} color={colors.textMuted} /></View>}
          <View style={s.topText}>
            <Text style={s.name}>{request.name}</Text>
            {sub ? <Text style={s.sub}>{sub}</Text> : null}
            {request.fits.slice(0, 2).map((f, i) => <FitText key={i} fit={f} style={s.sub} />)}
            {request.fits.length > 2 ? <Text style={s.meta}>{t('requirements.buyer.fitsMore', { count: request.fits.length - 2 })}</Text> : null}
          </View>
        </View>
        <View style={s.chips}>
          <StatusChip tone={requestStatusTone(request.status)} label={t(requestStatusKey(request.status))} />
          {request.matched ? <StatusChip tone="sun" label={t('requirements.matched')} /> : null}
          {request.urgent ? <StatusChip tone="warn" label={t('requirements.form.urgent')} /> : null}
        </View>
        <Text style={s.meta}>
          {[
            t('requirements.ref', { ref: request.ref }),
            request.targetedCount > 0 ? t('requirements.buyer.sentTo', { count: request.targetedCount }) : active ? t('requirements.buyer.finding') : null,
            active ? t(days.key, days.count !== undefined ? { count: days.count } : undefined) : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      {statusNotice ? (
        <Notice tone={statusNotice === 'removed' ? 'danger' : 'info'} icon={Info} text={t(`requirements.buyer.notice.${statusNotice}`)}>
          {statusNotice === 'expired' ? (
            <Button title={t('requirements.menu.renew')} size="sm" variant="outline" icon={RefreshCw} phLabel="Requirement-renew-notice" onPress={() => setSheet('renew')} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </Notice>
      ) : null}

      {active && request.fulfilPrompt ? (
        <FulfilBanner requestId={request.id} prompt={request.fulfilPrompt} busy={action.isPending} onFulfil={(dealId) => fulfil(dealId)} />
      ) : null}

      <Card>
        {detail(t('requirements.form.category'), request.categoryPath.map((c) => c.name).join(' › '))}
        {request.partNumber ? detail(t('requirements.form.partNumber'), request.partNumber, true) : null}
        {detail(t('requirements.form.budget'), request.budgetPerUnitPaise === null
          ? t('requirements.preview.noBudget')
          : `${formatRupees(request.budgetPerUnitPaise)} · ${t(request.budgetVisible ? 'requirements.buyer.budgetShown' : 'requirements.preview.budgetPrivate')}`)}
        {request.neededBy ? detail(t('requirements.form.neededBy'), formatDayMonth(Date.parse(`${request.neededBy}T06:30:00Z`))) : null}
        {detail(t('requirements.form.reach.label'), reachText)}
        {detail(t('requirements.form.audience.label'), t(`requirements.form.audience.${request.audience}`))}
        {active ? detail(t('requirements.buyer.expires'), formatDayMonth(Date.parse(request.expiresAt))) : null}
        {request.note ? <Text style={s.note}>{request.note}</Text> : null}
      </Card>

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'replies', label: t('requirements.buyer.tabReplies', { count: request.counts.replies }), testID: 'Requirement-tab-replies' },
          { value: 'matches', label: t('requirements.buyer.tabMatches', { count: request.counts.matches }), testID: 'Requirement-tab-matches' },
        ]}
      />
      {compareCount >= 2 ? (
        <Button
          title={t('requirements.buyer.compare', { count: compareCount })}
          variant="outline"
          size="sm"
          icon={ArrowLeftRight}
          phLabel="Requirement-compare"
          onPress={() => navigation.navigate('CompareResponses', { partRequestId: request.id })}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
    </View>
  );

  let empty: React.ReactElement;
  if (query.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (query.isError) {
    empty = (
      <EmptyState
        icon={Inbox}
        title={t('requirements.loadErrorTitle')}
        subtitle={t('requirements.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Requirement-list-retry"
        onCtaPress={() => void query.refetch()}
      />
    );
  } else {
    empty = (
      <EmptyState
        icon={tab === 'replies' ? Inbox : BellRing}
        title={t(`requirements.buyer.empty.${tab}.title`)}
        subtitle={t(`requirements.buyer.empty.${tab}.body`)}
      />
    );
  }

  const open = (listingId: string, source: 'reply' | 'match') => {
    track(REQUEST_EVENTS.requestResponseOpened, { source });
    navigation.navigate('Listing', { listingId });
  };

  return (
    <View style={s.flex} testID="RequirementBuyer">
      <Header
        title={t('requirements.buyer.title')}
        rightIcon={menuItems.length > 0 ? (
          <IconButton icon={EllipsisVertical} onPress={() => setSheet('menu')} accessibilityLabel={t('requirements.menu.a11y')} testID="Requirement-menu" />
        ) : undefined}
      />
      <FlatList<Item>
        data={data}
        keyExtractor={(x) => (x.type === 'reply' ? `r-${x.item.replyId}` : `m-${x.item.listingId}`)}
        renderItem={({ item: x }) => (x.type === 'reply'
          ? <ReplyCard item={x.item} onOpen={() => open(x.item.card.id, 'reply')} />
          : <MatchCard item={x.item} onOpen={() => open(x.item.listingId, 'match')} />)}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={s.list}
        refreshing={(replies.isRefetching || matches.isRefetching)}
        onRefresh={() => { void replies.refetch(); void matches.refetch(); }}
      />
      <ActionSheet visible={sheet === 'menu'} items={menuItems} onSelect={onMenu} onClose={() => setSheet(null)} />
      <CloseSheet
        visible={sheet === 'close'}
        busy={action.isPending}
        onClose={() => setSheet(null)}
        onConfirm={(reason) => run({ type: 'close', reason }, () => {
          track(REQUEST_EVENTS.requestClosed, { reason });
          Toast.show({ type: 'success', text1: t('requirements.toast.closed') });
        })}
      />
      <RenewSheet
        visible={sheet === 'renew'}
        validityDays={options.data?.validityDays ?? [request.validityDays]}
        expiresAt={request.expiresAt}
        renewableUntil={request.renewableUntil}
        busy={action.isPending}
        onClose={() => setSheet(null)}
        onConfirm={(d) => run({ type: 'renew', days: d }, () => {
          track(REQUEST_EVENTS.requestRenewed, { days: d });
          Toast.show({ type: 'success', text1: t('requirements.toast.renewed') });
        })}
      />
    </View>
  );
}
