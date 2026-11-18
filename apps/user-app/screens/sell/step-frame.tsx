import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import type { CategoryNode, ListingOwnerView, ListingPatch } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Steps from '@/components/Steps';
import FooterBar from '@/components/FooterBar';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useConfirm } from '@/components/ConfirmSheet';
import { listingErrorMessage } from '@/lib/listing-errors';
import type { SellStep } from '@/lib/sell-steps';
import { stepPosition } from '@/lib/sell-wizard';
import { radius, spacing } from '@/lib/theme';

/** What the Sell route host (`sell-step.tsx`) hands every step screen. */
export interface SellStepContext {
  listing: ListingOwnerView;
  tree: CategoryNode[];
  /** The listing's category node in the active tree (null before the category step, or when deactivated). */
  node: CategoryNode | null;
  hasSides: boolean;
  step: SellStep;
  /** `edit`: one step opened from the Edit listing menu; Next is Save and goes back. */
  mode: 'create' | 'edit';
  /** PATCH without moving (Back's autosave, the media step's cover). Stores the answer in the owner view. */
  save: (patch: ListingPatch) => Promise<ListingOwnerView>;
  /** Next: save the step's fields (null: nothing to save) and open the next step, or go back in edit mode. */
  complete: (patch: ListingPatch | null) => Promise<void>;
}

export interface StepProps {
  ctx: SellStepContext;
}

interface StepFrameProps {
  ctx: SellStepContext;
  /** The step's PATCH from the current values; null when the step has nothing to save. */
  patch: () => ListingPatch | null;
  /**
   * Next's checks: false keeps the seller here (the form shows its errors). `loose` (Back's autosave) skips what only
   * publish needs, such as required template fields (a draft PATCH allows them empty, §4.2).
   */
  validate: (opts: { loose: boolean }) => Promise<boolean> | boolean;
  /** Leaving would drop work in progress (uploads): ask first, and hold Back / Next. */
  hold?: boolean;
  nextDisabled?: boolean;
  /** Overrides the Next label ("Preview listing" on the last step). */
  nextLabel?: string;
  children: React.ReactNode;
}

const snapshot = (p: ListingPatch | null): string => JSON.stringify(p ?? null);

/**
 * One step of the sell wizard (F2 spec §5.2, §5.3): the app bar, the Steps bar ("Step 3 of 8"), the step's body, and
 * the FooterBar with Back and Next. Next validates, saves the step's fields (`PATCH`) and moves on. Leaving the step
 * any other way — Back, the app bar, the hardware back, a swipe — saves what changed first (the autosave on Back);
 * when that can't be saved, the seller is asked before the changes are dropped.
 */
export default function StepFrame({ ctx, patch, validate, hold = false, nextDisabled, nextLabel, children }: StepFrameProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  // What the server holds for this step: the values at mount, then after each save.
  const [saved, setSaved] = useState(() => snapshot(patch()));
  const leaving = useRef(false);
  const current = snapshot(patch());
  const dirty = current !== saved;

  const { step, listing, mode } = ctx;
  const pos = stepPosition(listing.kind, ctx.hasSides, step);
  const label = t(`sell.steps.${step}`);

  usePreventRemove(dirty || hold, ({ data }) => {
    const go = () => {
      leaving.current = true;
      navigation.dispatch(data.action);
    };
    if (leaving.current) return go();
    void (async () => {
      if (hold) {
        if (await confirm({ title: t('sell.leave.uploadsTitle'), message: t('sell.leave.uploadsMessage'), confirmLabel: t('sell.leave.leave'), destructive: true })) go();
        return;
      }
      const p = patch();
      if (p && (await validate({ loose: true }))) {
        setBusy(true);
        try {
          await ctx.save(p);
          go();
          return;
        } catch (err) {
          Toast.show({ type: 'error', text1: listingErrorMessage(err) });
        } finally {
          setBusy(false);
        }
      }
      if (await confirm({ title: t('sell.leave.unsavedTitle'), message: t('sell.leave.unsavedMessage'), confirmLabel: t('sell.leave.leave'), destructive: true })) go();
    })();
  });

  const onNext = useCallback(async () => {
    if (busy || hold) return;
    if (!(await validate({ loose: false }))) return;
    const p = patch();
    setBusy(true);
    leaving.current = true;
    try {
      await ctx.complete(p);
      setSaved(snapshot(p));
    } catch (err) {
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    } finally {
      leaving.current = false;
      setBusy(false);
    }
  }, [busy, hold, validate, patch, ctx]);

  const s = useMemo(() => StyleSheet.create({
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
    steps: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  }), []);

  const last = mode === 'create' && pos.current === pos.total;
  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={label} />
      {mode === 'create' ? (
        <Steps current={pos.current} total={pos.total} label={t('sell.stepOf', { ...pos, label })} style={s.steps} />
      ) : null}
      <View style={s.body}>{children}</View>
      <FooterBar>
        {mode === 'create' ? (
          <Button
            title={t('common.back')}
            phLabel="Sell-back"
            variant="outline"
            size="md"
            disabled={busy || hold}
            onPress={() => navigation.goBack()}
          />
        ) : null}
        <Button
          title={nextLabel ?? (mode === 'edit' ? t('common.save') : last ? t('sell.previewListing') : t('sell.next'))}
          phLabel={mode === 'edit' ? 'Sell-save' : 'Sell-next'}
          size="md"
          loading={busy}
          disabled={nextDisabled || hold}
          onPress={() => void onNext()}
        />
      </FooterBar>
    </ScreenWrapper>
  );
}

/** A loading body for a step waiting on its own data (template, brands, master data). */
export function StepSkeleton() {
  return (
    <View style={{ gap: spacing.md }}>
      {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 52, borderRadius: radius.md }} />)}
    </View>
  );
}
