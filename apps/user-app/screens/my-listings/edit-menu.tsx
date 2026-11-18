import React, { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ListRow from '@/components/ListRow';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { useCategoryTree, useOwnerListing } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import {
  ArrowLeftRight, CalendarClock, Camera, ClipboardList, Factory, MapPin, Package, Tag, TriangleAlert, Wrench, type LucideIcon,
} from '@/lib/icons';
import { listingErrorMessage } from '@/lib/listing-errors';
import { editEntry, editSections, nodeHasSides } from '@/lib/my-listings';
import type { EditStep } from '@/lib/sell-wizard';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const STEP_ICONS: Record<EditStep, LucideIcon> = {
  category: ClipboardList,
  part_details: Wrench,
  machine: Factory,
  quantity: Package,
  rates: CalendarClock,
  fit: Wrench,
  side: ArrowLeftRight,
  media: Camera,
  price: Tag,
  location: MapPin,
};

/**
 * Edit listing (F2 spec §10, §7.3): one row per section of the listing's kind, each opening that step in edit mode
 * (`Sell { mode: 'edit' }`, with Save) rather than the linear wizard. No Category on a published listing (R43); a
 * rejected listing (or a draft) re-runs the wizard instead. Sections a `needsAttention` nudge points at are marked;
 * while a report is open (`reviewOnEdit`) side and fit changes are flagged as checked by the team.
 */
export default function EditMenuScreen({ navigation, route }: RootStackScreenProps<'ListingEditMenu'>) {
  const { listingId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const owner = useOwnerListing(listingId);
  const tree = useCategoryTree();
  const listing = owner.data;
  const entry = listing ? editEntry(listing.status) : null;

  // A rejected listing (or a draft) is edited through the wizard, from the category step.
  useEffect(() => {
    if (entry === 'wizard') navigation.replace('Sell', { listingId, step: 'category', mode: 'create' });
  }, [entry, listingId, navigation]);

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, gap: spacing.lg },
    title: { ...type('cardTitle'), color: colors.text },
    hint: { ...type('caption'), color: colors.textSecondary },
    skeleton: { height: 280, borderRadius: radius.xl },
  }), [colors, type]);

  let content: React.ReactNode;
  if (owner.isLoading) {
    content = <Skeleton style={s.skeleton} />;
  } else if (!listing) {
    content = (
      <EmptyState
        icon={TriangleAlert}
        title={t('listing.page.loadErrorTitle')}
        subtitle={owner.error ? listingErrorMessage(owner.error) : t('listing.page.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Edit-menu-retry"
        onCtaPress={() => void owner.refetch()}
      />
    );
  } else if (entry === null) {
    content = <Notice tone="warning" icon={TriangleAlert} text={t('listing.errors.notEditable')} />;
  } else {
    const sections = editSections(listing, nodeHasSides(tree.data, listing.categoryId));
    content = (
      <>
        <View style={{ gap: spacing.xs }}>
          <Text style={s.title} numberOfLines={2}>{listing.title}</Text>
          <Text style={s.hint}>{t('listing.editMenu.hint')}</Text>
        </View>
        {listing.reviewOnEdit ? <Notice tone="info" text={t('listing.editMenu.reportWarning')} /> : null}
        <Card flush>
          {sections.map((sec, i) => (
            <ListRow
              key={sec.step}
              icon={STEP_ICONS[sec.step]}
              label={t(`listing.editMenu.step.${sec.step}`)}
              trailing={sec.attention ? <StatusChip label={t('listing.editMenu.needsAttention')} tone="warn" /> : undefined}
              chevron
              last={i === sections.length - 1}
              onPress={() => navigation.navigate('Sell', { listingId, step: sec.step, mode: 'edit' })}
              testID={`Edit-menu-${sec.step}`}
              accessibilityRole="button"
            />
          ))}
        </Card>
      </>
    );
  }

  return (
    <ScreenWrapper>
      <Header title={t('listing.editMenu.title')} />
      <ScrollView contentContainerStyle={s.body}>{content}</ScrollView>
    </ScreenWrapper>
  );
}
