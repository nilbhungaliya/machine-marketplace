import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { RentalBookingView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';
import StepPhotos, { photoUploadMessage, useStepPhotos } from '@/components/rentals/StepPhotos';
import { isStaleBookingError, useBookingWrite } from '@/hooks/use-rental-booking';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { dateRangeLabel } from '@/lib/rental-display';
import { parseHourMeter } from '@/lib/rental-return';
import { markBookingOnSite } from '@/lib/rentals-api';
import { useTheme } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n/language';

export interface OnSiteSheetProps {
  /** A `confirmed` booking, either side, from `startDate − 1` (spec §6.4). */
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/on-site`. */
  onDone: (view: RentalBookingView) => void;
}

/**
 * Machine on site (§6.4): either side marks it, with an optional opening hour meter (mono) and up to three private
 * photos. On site never checks capacity (the machine is physically there); the timeline says who marked it.
 */
export default function OnSiteSheet({ view, visible, onClose, onDone }: OnSiteSheetProps) {
  const { t } = useTranslation();
  const lang = useLanguage();
  const { colors } = useTheme();
  const type = useType();
  const write = useBookingWrite(view.id);
  const photos = useStepPhotos(view.id);
  const [meter, setMeter] = useState('');
  const [tried, setTried] = useState(false);
  const { reset } = photos;

  useEffect(() => {
    if (!visible) return;
    setMeter('');
    setTried(false);
    reset();
  }, [visible, reset]);

  const s = useMemo(() => StyleSheet.create({
    body: { ...type('body'), color: colors.textSecondary },
  }), [colors, type]);

  const hour = parseHourMeter(meter);
  const busy = photos.uploading || write.isPending;

  const submit = async () => {
    setTried(true);
    if (hour.invalid) return;
    let photoKeys: string[] = [];
    try {
      photoKeys = await photos.upload();
    } catch (err) {
      Toast.show({ type: 'error', text1: photoUploadMessage(err) });
      return;
    }
    write.mutate(
      (key) => markBookingOnSite(view.id, {
        ...(hour.value != null ? { hourMeter: hour.value } : {}),
        ...(photoKeys.length > 0 ? { photoKeys } : {}),
      }, key),
      {
        onSuccess: (fresh) => {
          track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'on_site', status: fresh.status });
          Toast.show({ type: 'success', text1: t('rentalsOwner.onSite.done') });
          onDone(fresh);
          onClose();
        },
        onError: (err) => {
          track(RENTAL_EVENTS.bookingActionFailed, { bookingId: view.id, action: 'on_site', reason: errorCode(err) });
          Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
          if (isStaleBookingError(err)) onClose();
        },
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('rentalsOwner.onSite.title')}
      subtitle={t('rentalsOwner.onSite.subtitle', {
        ref: view.ref,
        dates: dateRangeLabel(view.current.startDate, view.current.endDate, lang),
      })}
      testID="OnSite-backdrop"
    >
      <Text style={s.body}>{t('rentalsOwner.onSite.body')}</Text>
      <Input
        label={t('rentalsOwner.meter.opening')}
        value={meter}
        onChangeText={setMeter}
        keyboardType="number-pad"
        mono
        placeholder={t('rentalsOwner.meter.placeholder')}
        error={tried && hour.invalid ? t('rentalsOwner.meter.invalid') : undefined}
        testID="OnSite-meter"
      />
      <StepPhotos photos={photos.photos} onChange={photos.setPhotos} testID="OnSite" />
      <Button
        title={t('rentalsOwner.onSite.submit')}
        onPress={() => void submit()}
        loading={busy}
        phLabel="OnSite-confirm"
      />
    </BottomSheet>
  );
}
