import React, { useMemo, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { EffectiveTemplate, ListingDetail, ListingMediaItem } from '@mpm/shared-types';
import { MapPin, Package, Play, ShieldCheck, Star, TriangleAlert, Truck } from '@/lib/icons';
import { availabilityLine } from '@/lib/listing-page';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import {
  availabilityText, conditionLabel, deliveryLabel, distanceText, fitLine, galleryOrder, headlinePrice, hoursRunText,
  placeText, priceNote, quantityText, refText, rentalRateCards, rentalTermRows, sideLabel, sideTokenKind, specRows,
  unitPer, updatedAgo,
} from '@/lib/listing-format';
import { formatMonthYear } from '@/lib/format-date';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Notice from '@/components/Notice';
import PriceText from '@/components/PriceText';
import SideToken from '@/components/SideToken';
import StatusChip from '@/components/StatusChip';

/**
 * The listing body shared by the seller's Preview (Task 25, from the owner view) and the listing page (Task 26, from
 * the public detail): F2 spec §8.1's blocks as one scrolling page (§8.5: no tabs, quantity picker, rating, save or
 * share). It draws only what the payload holds; the screen around it owns the header, the FooterBar and the data
 * fetching, and passes the parts that need their own queries as slots (Other side, More from this seller).
 *
 * Contract (lanes L5 and L6):
 * - `listing`: a `ListingDetail` or `ListingOwnerView` (it extends it). Private owner fields (serial number, godown
 *   address, pincode) are never drawn here, so Preview shows what a buyer sees.
 * - `template`: the node's template with retired fields and options (`useListingTemplate(listing)`, `includeRetired=1`)
 *   for the Specifications labels and order, so values for retired fields keep their labels; without it the template
 *   fields are left out (part number, brand, machine rows still show).
 * - `header`: drawn first, above the gallery (Preview's "This is how buyers will see it", score and warnings).
 * - `otherSide`: block 5 (parts with `left` / `right`; L6 builds it from `GET …/other-side`). Not drawn when absent.
 * - `moreFromSeller`: block 9 (L6). Not drawn when absent.
 * - `onOpenMedia(index)`: a gallery tap (L6 opens `ListingMedia`). No-op when absent.
 * - `onCheckFit`: shows "Check my machine" in the Fits block (L6's sheet).
 * - `onViewSeller`: shows "View all listings" on the seller card (L6 → `SellerListings`).
 * - `onReport`: shows "Report listing" (block 10); never on the viewer's own listing (`isOwner`).
 * - `onViewReviews`: the seller's stars and review count link to Seller reviews (F6 + F7 §15.2, when `seller.score`).
 * - `bottomInset`: space under the last block for the screen's FooterBar.
 * - `now`: for "Updated 3 days ago" and the rental's availability (tests, stable renders).
 */
export interface ListingViewProps {
  listing: ListingDetail;
  template?: EffectiveTemplate | null;
  header?: React.ReactNode;
  otherSide?: React.ReactNode;
  moreFromSeller?: React.ReactNode;
  onOpenMedia?: (index: number) => void;
  onCheckFit?: () => void;
  onViewSeller?: () => void;
  onReport?: () => void;
  onViewReviews?: () => void;
  bottomInset?: number;
  now?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export default function ListingView({
  listing, template, header, otherSide, moreFromSeller, onOpenMedia, onCheckFit, onViewSeller, onReport, onViewReviews,
  bottomInset = spacing.xxxl, now, testID, style,
}: ListingViewProps) {
  const { t } = useTranslation();
  const { colors, shadows } = useTheme();
  const type = useType();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const s = useMemo(() => StyleSheet.create({
    content: { gap: spacing.md },
    gallery: {
      height: 300, backgroundColor: colors.photo, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet,
      overflow: 'hidden',
    },
    slide: { height: 300 },
    image: { width: '100%', height: '100%' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
    emptyText: { ...type('caption'), color: colors.textMuted },
    counter: {
      ...type('badge'), position: 'absolute', right: spacing.md, bottom: spacing.md, color: colors.text,
      backgroundColor: colors.surface, borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 3,
      overflow: 'hidden',
    },
    playWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    play: {
      width: 56, height: 56, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center', ...shadows.raised,
    },
    blocks: { paddingHorizontal: spacing.lg, gap: spacing.md },
    card: { gap: spacing.sm },
    tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    sideTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
    sideText: { ...type('label'), color: colors.text },
    pill: {
      ...type('badge'), color: colors.textSecondary, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
      borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 3, overflow: 'hidden',
    },
    title: { ...type('title'), color: colors.text },
    meta: { ...type('caption'), color: colors.textMuted },
    body: { ...type('body'), color: colors.text },
    small: { ...type('caption'), color: colors.textSecondary },
    section: { ...type('section'), color: colors.text },
    rates: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    rate: {
      flexGrow: 1, flexBasis: '30%', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    },
    rateFirst: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
    rateAmount: { ...type('price'), fontSize: 18, lineHeight: 22, color: colors.text },
    rateLabel: { ...type('caption'), color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    fit: {
      ...type('chip'), color: colors.primaryInk, backgroundColor: colors.primaryWash, borderRadius: radius.full,
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, overflow: 'hidden',
    },
    row: {
      flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { ...type('caption'), color: colors.textSecondary, flex: 1 },
    rowValue: { ...type('bodyStrong'), color: colors.text, flex: 1, textAlign: 'right' },
    mono: { ...type('mono'), color: colors.text, flex: 1, textAlign: 'right' },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    sellerName: { ...type('cardTitle'), color: colors.text },
    report: { alignSelf: 'center' },
    held: {
      ...type('badge'), color: colors.warn, backgroundColor: colors.warnSoft, borderRadius: radius.full,
      paddingHorizontal: spacing.sm + 2, paddingVertical: 3, overflow: 'hidden',
    },
    score: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    scoreText: { ...type('label'), color: colors.text },
  }), [colors, shadows, type]);

  const media = useMemo(() => galleryOrder(listing.media), [listing.media]);
  const kind = listing.kind;
  const isPart = kind === 'part';
  const isRental = kind === 'machine_rental';
  const hasSide = isPart && (listing.side === 'left' || listing.side === 'right' || listing.side === 'pair');

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  };

  const slide = (m: ListingMediaItem, i: number) => {
    const uri = m.type === 'photo' ? m.url ?? m.thumbUrl : m.thumbUrl;
    return (
      <Pressable
        key={m.id}
        style={[s.slide, { width }]}
        onPress={() => onOpenMedia?.(i)}
        disabled={!onOpenMedia}
        accessibilityRole={onOpenMedia ? 'imagebutton' : 'image'}
        accessibilityLabel={m.type === 'video' ? t('listing.view.playVideo') : t('listing.view.openPhoto', { index: i + 1 })}
        testID={`Listing-media-${i}`}
      >
        {uri ? <Image source={{ uri }} style={s.image} contentFit="cover" transition={150} accessibilityIgnoresInvertColors /> : null}
        {m.type === 'video' ? (
          <View style={s.playWrap} pointerEvents="none">
            <View style={s.play}><Play size={24} color={colors.primaryInk} fill={colors.primaryInk} /></View>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const specs = template ? specRows(template.fields, listing.specs) : [];
  const machine = listing.machine;
  const detailRows: { key: string; label: string; value: string; mono?: boolean }[] = [
    ...specs.map((r) => ({ key: `spec-${r.key}`, label: r.label, value: r.value })),
    ...(isPart && listing.partNumber ? [{ key: 'partNumber', label: t('listing.view.partNumber'), value: listing.partNumber, mono: true }] : []),
    ...(isPart && listing.partBrand ? [{ key: 'partBrand', label: t('listing.view.partBrand'), value: listing.partBrand.name }] : []),
    ...(machine && (machine.brandName || machine.brandOther)
      ? [{ key: 'make', label: t('listing.view.make'), value: (machine.brandName ?? machine.brandOther)! }] : []),
    ...(machine && (machine.modelName || machine.modelOther)
      ? [{ key: 'model', label: t('listing.view.model'), value: (machine.modelName ?? machine.modelOther)! }] : []),
    ...(machine?.year != null ? [{ key: 'year', label: t('listing.view.year'), value: String(machine.year) }] : []),
    ...(machine?.hoursRun != null ? [{ key: 'hours', label: t('listing.view.hoursRun'), value: hoursRunText(machine.hoursRun) }] : []),
    ...(machine?.underPower ? [{ key: 'running', label: t('listing.view.running'), value: t('listing.view.yes') }] : []),
    ...(machine?.inspectionByAppointment ? [{ key: 'inspection', label: t('listing.view.inspection'), value: t('listing.view.yes') }] : []),
    { key: 'ref', label: t('listing.view.reference'), value: refText(listing.ref), mono: true },
  ];

  const price = headlinePrice(listing);
  const rateCards = isRental && listing.rental ? rentalRateCards(listing.rental) : [];
  const termRows = isRental && listing.rental ? rentalTermRows(listing.rental) : [];
  const updated = updatedAgo(listing.refreshedAt ?? listing.publishedAt, now);
  const place = [placeText(listing), listing.state].filter(Boolean).join(', ');
  const distance = distanceText(listing.distanceKm);
  const seller = listing.seller;
  const sellerPlace = [seller.industrialAreaName, seller.city].filter(Boolean).join(', ');
  const memberSince = Date.parse(seller.memberSince);
  const availability = availabilityLine(listing);

  return (
    <ScrollView
      style={style}
      contentContainerStyle={[s.content, { paddingBottom: bottomInset }]}
      showsVerticalScrollIndicator={false}
      testID={testID ?? 'Listing-view'}
    >
      {header}

      {/* 1. Gallery */}
      <View style={s.gallery}>
        {media.length > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScrollEnd}>
            {media.map(slide)}
          </ScrollView>
        ) : (
          <View style={s.empty}>
            <Package size={48} color={colors.textMuted} />
            <Text style={s.emptyText}>{t('listing.view.noPhoto')}</Text>
          </View>
        )}
        {media.length > 1 ? (
          <Text style={s.counter} pointerEvents="none">
            {t('listing.view.mediaCounter', { index: Math.min(page, media.length - 1) + 1, total: media.length })}
          </Text>
        ) : null}
      </View>

      <View style={s.blocks}>
        {/* 2–3. Tags, title, price */}
        <Card style={s.card}>
          <View style={s.tags}>
            {hasSide ? (
              <View style={s.sideTag}>
                <SideToken kind={sideTokenKind(listing.side)} />
                <Text style={s.sideText}>{sideLabel(listing.side)}</Text>
              </View>
            ) : null}
            {isRental ? <StatusChip label={t('listing.view.forRent')} tone="info" /> : null}
            {!isRental && listing.condition ? <Text style={s.pill}>{conditionLabel(listing.condition)}</Text> : null}
            {!isRental && listing.quantity ? (
              availability?.kind === 'none' ? (
                <Text style={s.held} testID="Listing-all-on-hold">{t('listing.available.allOnHold')}</Text>
              ) : availability?.kind === 'partial' ? (
                <Text style={s.pill} testID="Listing-available">
                  {t('listing.available.partial', {
                    available: quantityText(availability.available, null), quantity: quantityText(availability.quantity, listing.unit),
                  })}
                </Text>
              ) : (
                <Text style={s.pill}>{quantityText(listing.quantity, listing.unit)}</Text>
              )
            ) : null}
            {isRental && listing.rental?.operator ? <Text style={s.pill}>{t(`listing.rental.operator.${listing.rental.operator}`)}</Text> : null}
            {isRental && machine?.year != null ? <Text style={s.pill}>{String(machine.year)}</Text> : null}
          </View>
          <Text style={s.title} testID="Listing-title">{listing.title}</Text>
          {updated ? <Text style={s.meta}>{updated}</Text> : null}
          {price ? (
            <PriceText
              size="xl"
              paise={price.type === 'amount' ? price.paise : null}
              suffix={isPart ? unitPer(listing.unit) : undefined}
              note={priceNote(listing)}
              fallback={t('listing.price.onRequest')}
              testID="Listing-price"
            />
          ) : null}
          {!isRental && listing.minOrderQty ? (
            <Text style={s.small}>{t('listing.view.minOrder', { qty: quantityText(listing.minOrderQty, listing.unit) })}</Text>
          ) : null}
        </Card>

        {/* Rentals: rate cards and terms (§8.1 item 3) */}
        {isRental && listing.rental ? (
          <Card style={s.card}>
            <Text style={s.section}>{t('listing.view.rates')}</Text>
            <View style={s.rates}>
              {rateCards.map((r, i) => (
                <View key={r.period} style={[s.rate, i === 0 && s.rateFirst]}>
                  <Text style={s.rateAmount}>{r.amount}</Text>
                  <Text style={s.rateLabel}>{r.label}</Text>
                </View>
              ))}
            </View>
            <Text style={s.small}>
              {[
                t('listing.view.shiftHours', { count: listing.rental.shiftHours }),
                t('listing.view.monthDays', { count: listing.rental.monthDays }),
              ].join(' · ')}
            </Text>
            <Text style={s.section}>{t('listing.view.terms')}</Text>
            <View>
              {termRows.map((r, i) => (
                <View key={r.key} style={[s.row, i === termRows.length - 1 && s.rowLast]}>
                  <Text style={s.rowLabel}>{r.label}</Text>
                  <Text style={s.rowValue}>{r.value}</Text>
                </View>
              ))}
            </View>
            <Text style={s.small}>{availabilityText(listing.rental.availableFrom, now)}</Text>
            {listing.rental.availabilityNote ? <Text style={s.small}>{listing.rental.availabilityNote}</Text> : null}
          </Card>
        ) : null}

        {/* M19 tip on machine listings */}
        {!isPart ? <Notice tone="warning" icon={TriangleAlert} text={t('listing.view.machineTip')} /> : null}

        {/* Description and condition note */}
        {listing.description || listing.conditionNote ? (
          <Card style={s.card}>
            {listing.description ? (
              <>
                <Text style={s.section}>{t('listing.view.description')}</Text>
                <Text style={s.body}>{listing.description}</Text>
              </>
            ) : null}
            {listing.conditionNote ? (
              <>
                <Text style={s.section}>{t('listing.view.conditionNote')}</Text>
                <Text style={s.body}>{listing.conditionNote}</Text>
              </>
            ) : null}
          </Card>
        ) : null}

        {/* 4. Fits */}
        {isPart && listing.fitments.length > 0 ? (
          <Card style={s.card}>
            <Text style={s.section}>{t('listing.view.fitsTitle')}</Text>
            <View style={s.chips}>
              {listing.fitments.map((f, i) => (
                <Text key={f.id ?? `fit-${i}`} style={s.fit}>{fitLine(f)}</Text>
              ))}
            </View>
            {onCheckFit ? (
              <Button
                title={t('listing.view.checkMyMachine')}
                onPress={onCheckFit}
                variant="outline"
                size="sm"
                phLabel="Listing-check-my-machine"
                style={{ alignSelf: 'flex-start' }}
              />
            ) : null}
          </Card>
        ) : null}

        {/* 5. Other side (slot) */}
        {otherSide ?? null}

        {/* 6. Specifications */}
        <Card style={s.card}>
          <Text style={s.section}>{t('listing.view.specsTitle')}</Text>
          <View>
            {detailRows.map((r, i) => (
              <View key={r.key} style={[s.row, i === detailRows.length - 1 && s.rowLast]}>
                <Text style={s.rowLabel}>{r.label}</Text>
                <Text style={r.mono ? s.mono : s.rowValue}>{r.value}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* 7. Delivery and location */}
        <Card style={s.card}>
          <Text style={s.section}>{t('listing.view.deliveryTitle')}</Text>
          {listing.delivery.length > 0 ? (
            <View style={s.chips}>
              {listing.delivery.map((d) => (
                <View key={d} style={s.line}>
                  <Truck size={16} color={colors.primaryInk} />
                  <Text style={s.small}>{deliveryLabel(d)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {place ? (
            <View style={s.line}>
              <MapPin size={16} color={colors.textMuted} />
              <Text style={s.small}>{distance ? `${place} · ${distance}` : place}</Text>
            </View>
          ) : null}
          {isRental && listing.rental?.serviceRadiusKm != null ? (
            <Text style={s.small}>{t('listing.view.worksWithin', { km: listing.rental.serviceRadiusKm })}</Text>
          ) : null}
        </Card>

        {/* 8. Seller: stars and review count once published (F6 + F7 §10.4); no deals or reply time yet */}
        <Card style={s.card}>
          <Text style={s.section}>{t('listing.view.sellerTitle')}</Text>
          <Text style={s.sellerName}>{seller.displayName}</Text>
          {sellerPlace ? <Text style={s.small}>{sellerPlace}</Text> : null}
          {seller.gstVerified ? <StatusChip label={t('listing.view.gstVerified')} tone="ok" icon={ShieldCheck} /> : null}
          {seller.score ? (
            <View style={s.score}>
              <Star size={16} color={colors.star} fill={colors.star} />
              <Text style={s.scoreText}>
                {t('listing.view.sellerScore', { stars: seller.score.stars.toFixed(1), count: seller.score.count })}
              </Text>
              {onViewReviews ? (
                <Button title={t('listing.view.reviews')} onPress={onViewReviews} variant="ghost" size="sm" phLabel="Listing-seller-reviews" />
              ) : null}
            </View>
          ) : null}
          <Text style={s.small}>
            {[
              Number.isNaN(memberSince) ? '' : t('listing.view.memberSince', { date: formatMonthYear(memberSince) }),
              t('listing.view.liveListings', { count: seller.liveListings }),
            ].filter(Boolean).join(' · ')}
          </Text>
          {onViewSeller ? (
            <Button
              title={t('listing.view.viewAll')}
              onPress={onViewSeller}
              variant="outline"
              size="sm"
              phLabel="Listing-view-seller"
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </Card>

        {/* 9. More from this seller (slot) */}
        {moreFromSeller ?? null}

        {/* 10. Report listing */}
        {onReport && !listing.isOwner ? (
          <Button
            title={t('listing.view.report')}
            onPress={onReport}
            variant="ghost"
            size="sm"
            phLabel="Listing-report"
            style={s.report}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
