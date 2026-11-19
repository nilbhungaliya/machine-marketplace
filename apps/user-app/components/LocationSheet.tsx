import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { DISCOVERY_RADII_KM, type DiscoveryRadiusKm } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import { useDiscoveryOrigin } from '@/hooks/use-discovery-origin';
import { errorKey } from '@/lib/api-error';
import { fetchPincode } from '@/lib/business-api';
import { normalisePincode } from '@/lib/discovery-origin';
import { Building2, LocateFixed } from '@/lib/icons';
import { spacing } from '@/lib/theme';

interface LocationSheetProps {
  visible: boolean;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

const RADII: Array<DiscoveryRadiusKm | null> = [...DISCOVERY_RADII_KM, null];

/**
 * The location sheet (F4 + F5 spec §8.2): Use my location (asks again, or opens Settings when blocked) · Use my
 * business location (signed in) · Enter pincode (6 digits, Hindi / Gujarati digits accepted, checked against the
 * pincode directory) · radius chips 10 / 25 / 50 / 100 / 200 km and All India. Choices are stored on the phone
 * (radius, pincode, source); coordinates never are.
 */
export default function LocationSheet({ visible, onClose, style }: LocationSheetProps) {
  const { t } = useTranslation();
  const origin = useDiscoveryOrigin();
  const [pincode, setPincode] = useState('');
  const [pincodeError, setPincodeError] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPincode(origin.pincode ?? '');
    setPincodeError(undefined);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    radii: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pincodeRow: { gap: spacing.sm },
  }), []);

  const gpsOn = origin.mode === 'auto' && origin.permission === 'granted';
  const gpsHint = origin.permission === 'blocked'
    ? t('discover.location.gpsBlocked')
    : t('discover.location.useGpsHint');

  const useGps = async () => {
    setLocating(true);
    try {
      const permission = await origin.chooseGps();
      if (permission === 'granted') onClose();
      else if (permission === 'denied') Toast.show({ type: 'info', text1: t('discover.location.gpsDenied') });
    } finally {
      setLocating(false);
    }
  };

  const useBusiness = () => {
    origin.chooseBusiness();
    onClose();
  };

  const applyPincode = async () => {
    const value = normalisePincode(pincode);
    if (!value) {
      setPincodeError(t('discover.location.pincodeInvalid'));
      return;
    }
    setChecking(true);
    try {
      const info = await fetchPincode(value);
      if (!info) {
        setPincodeError(t('discover.location.pincodeUnknown'));
        return;
      }
      origin.choosePincode(value);
      onClose();
    } catch (err) {
      setPincodeError(t(errorKey(err, {})));
    } finally {
      setChecking(false);
    }
  };

  const radiusText = (r: DiscoveryRadiusKm | null) => (r === null ? t('discover.radius.allIndia') : t('discover.radius.km', { km: r }));

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('discover.location.sheetTitle')} testID="Location-sheet-backdrop" style={style}>
      <Card flush>
        <ListRow
          icon={LocateFixed}
          label={t('discover.location.useGps')}
          hint={gpsHint}
          selected={gpsOn}
          last={!origin.signedIn}
          disabled={locating}
          onPress={() => void useGps()}
          testID="Location-use-gps"
          accessibilityRole="button"
          accessibilityState={{ selected: gpsOn, busy: locating }}
        />
        {origin.signedIn ? (
          <ListRow
            icon={Building2}
            label={t('discover.location.useBusiness')}
            hint={t('discover.location.useBusinessHint')}
            selected={origin.mode === 'business'}
            last
            onPress={useBusiness}
            testID="Location-use-business"
            accessibilityRole="button"
            accessibilityState={{ selected: origin.mode === 'business' }}
          />
        ) : null}
      </Card>

      <View style={s.pincodeRow}>
        <Input
          label={t('discover.location.pincodeLabel')}
          placeholder={t('discover.location.pincodePlaceholder')}
          value={pincode}
          onChangeText={(text) => {
            setPincode(text);
            setPincodeError(undefined);
          }}
          keyboardType="number-pad"
          maxLength={6}
          error={pincodeError}
          returnKeyType="done"
          onSubmitEditing={() => void applyPincode()}
          testID="Location-pincode"
        />
        <Button
          title={t('discover.location.pincodeApply')}
          phLabel="Location-pincode-apply"
          variant="outline"
          size="md"
          loading={checking}
          disabled={pincode.trim() === ''}
          onPress={() => void applyPincode()}
        />
      </View>

      <Field label={t('discover.location.radiusLabel')}>
        <View style={s.radii} accessibilityRole="radiogroup">
          {RADII.map((r) => (
            <Chip
              key={r ?? 'all'}
              label={radiusText(r)}
              role="radio"
              selected={origin.radiusKm === r}
              onPress={() => origin.chooseRadius(r)}
              testID={`Location-radius-${r ?? 'all'}`}
            />
          ))}
        </View>
      </Field>

      <Button title={t('common.done')} phLabel="Location-sheet-done" onPress={onClose} />
    </BottomSheet>
  );
}
