import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { ListingPatch } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { useCategoryTree } from '@/hooks/use-listing';
import { useSellDraft } from '@/hooks/use-sell-draft';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { TriangleAlert } from '@/lib/icons';
import { listingErrorKey } from '@/lib/listing-errors';
import { findNode, hasSidesFor } from '@/lib/sell-category';
import { firstIncompleteStep, nextStep } from '@/lib/sell-wizard';
import { radius, spacing } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import type { SellStepContext } from './step-frame';
import StepCategory from './step-category';
import StepPartDetails from './step-part-details';
import StepMachine from './step-machine';
import StepQuantity from './step-quantity';
import StepFit from './step-fit';
import StepSide from './step-side';
import StepMedia from './step-media';
import StepPrice from './step-price';
import StepRates from './step-rates';
import StepLocation from './step-location';
import Preview from './preview';

/**
 * The `Sell` route (F2 spec §5.2, §5.3, §15.1): one route pushed per step, so Back works naturally. Loads the draft's
 * owner view (the wizard's source of truth) and the category tree (sides, breadcrumbs), then draws the step. Next
 * saves the step (`PATCH`) and pushes the next step from `nextStep(kind, hasSides, step)`; in `edit` mode it saves
 * and goes back to the Edit listing menu.
 */
export default function SellStepScreen({ navigation, route }: RootStackScreenProps<'Sell'>) {
  const { listingId, step, mode = 'create' } = route.params;
  const { t } = useTranslation();
  const draft = useSellDraft(listingId);
  const tree = useCategoryTree();
  const listing = draft.listing;

  const ctx = useMemo<SellStepContext | null>(() => {
    if (!listing || !tree.data) return null;
    const nodes = tree.data;
    return {
      listing,
      tree: nodes,
      node: findNode(nodes, listing.categoryId),
      hasSides: hasSidesFor(nodes, listing),
      step,
      mode,
      save: (patch: ListingPatch) => draft.save(patch),
      complete: async (patch: ListingPatch | null) => {
        let saved = listing;
        if (patch) saved = await draft.save(patch, step);
        else track(LISTING_EVENTS.sellStepCompleted, { kind: listing.kind, step });
        if (mode === 'edit') {
          Toast.show({ type: 'success', text1: t('sell.saved') });
          navigation.goBack();
          return;
        }
        const sides = hasSidesFor(nodes, saved);
        const next = nextStep(saved.kind, sides, step) ?? firstIncompleteStep(saved, sides);
        navigation.push('Sell', { listingId, step: next, mode });
      },
    };
    // `draft.save` is a new function each render; the context follows the listing, tree and route.
  }, [listing, tree.data, step, mode, listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) {
    const failed = draft.query.isError || tree.isError;
    return (
      <ScreenWrapper>
        <Header title={t(`sell.steps.${step}`)} />
        {failed ? (
          <EmptyState
            icon={TriangleAlert}
            title={t('sell.loadError')}
            subtitle={t(draft.query.isError ? listingErrorKey(draft.query.error) : 'errors.genericRetry')}
            ctaTitle={t('common.retry')}
            ctaPhLabel="Sell-retry"
            onCtaPress={() => { void draft.query.refetch(); void tree.refetch(); }}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.lg }}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 52, borderRadius: radius.md }} />)}
          </View>
        )}
      </ScreenWrapper>
    );
  }

  switch (step) {
    case 'category': return <StepCategory ctx={ctx} />;
    case 'part_details': return <StepPartDetails ctx={ctx} />;
    case 'machine': return <StepMachine ctx={ctx} />;
    case 'quantity': return <StepQuantity ctx={ctx} />;
    case 'fit': return <StepFit ctx={ctx} />;
    case 'side': return <StepSide ctx={ctx} />;
    case 'media': return <StepMedia ctx={ctx} />;
    case 'price': return <StepPrice ctx={ctx} />;
    case 'rates': return <StepRates ctx={ctx} />;
    case 'location': return <StepLocation ctx={ctx} />;
    case 'preview': return <Preview ctx={ctx} />;
  }
}

