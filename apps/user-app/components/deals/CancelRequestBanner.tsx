import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DealView, PartySide } from '@mpm/shared-types';
import Button from '@/components/Button';
import Notice from '@/components/Notice';
import { TriangleAlert } from '@/lib/icons';
import { spacing } from '@/lib/theme';

interface CancelRequestBannerProps {
  request: NonNullable<DealView['cancelRequest']>;
  mySide: PartySide;
  canAccept: boolean;
  canClear: boolean;
  busy?: boolean;
  onAccept: () => void;
  onClear: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A pending cancel request after handover (§9.5): the other side accepts (the deal is cancelled) or declines; the
 * requester can withdraw it. "Clear" is one server action for both (§27 30), worded per side.
 */
export default function CancelRequestBanner({
  request, mySide, canAccept, canClear, busy, onAccept, onClear, style,
}: CancelRequestBannerProps) {
  const { t } = useTranslation();
  const s = useMemo(() => StyleSheet.create({
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    action: { flex: 1 },
  }), []);
  const mine = request.side === mySide;
  const reason = request.reason ? t(`deals.cancelReason.${request.reason}`) : '';
  const text = mine
    ? t('deals.cancelRequest.mine')
    : reason ? t('deals.cancelRequest.theirsWithReason', { reason }) : t('deals.cancelRequest.theirs');

  return (
    <Notice tone="warning" icon={TriangleAlert} title={t('deals.cancelRequest.title')} text={text} style={style}>
      {canAccept || canClear ? (
        <View style={s.actions}>
          {canClear ? (
            <Button
              title={t(mine ? 'deals.cancelRequest.withdraw' : 'deals.cancelRequest.decline')}
              onPress={onClear}
              variant="outline"
              size="sm"
              disabled={busy}
              phLabel="Deal-cancel-request-clear"
              style={s.action}
            />
          ) : null}
          {canAccept ? (
            <Button
              title={t('deals.cancelRequest.accept')}
              onPress={onAccept}
              variant="danger"
              size="sm"
              disabled={busy}
              phLabel="Deal-cancel-request-accept"
              style={s.action}
            />
          ) : null}
        </View>
      ) : null}
    </Notice>
  );
}
