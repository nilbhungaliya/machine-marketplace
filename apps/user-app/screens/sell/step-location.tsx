import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import * as Location from 'expo-location';
import Toast from 'react-native-toast-message';
import { DELIVERY_OPTIONS } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import { useBusiness, useIndustrialAreas, usePincodeInfo } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
import { fetchNearestPincode } from '@/lib/business-api';
import { toAsciiDigits } from '@/lib/digits';
import { Building2, Info, LocateFixed, MapPin, Package, X } from '@/lib/icons';
import { deliveryLabel } from '@/lib/listing-format';
import { PINCODE_REGEX, pinAfterPincode } from '@/lib/onboarding-step';
import {
  ADDRESS_LINE_MAX, AREA_OTHER_MAX, locationInitial, locationPatch, translateErrors, validateLocation, type LocationValues,
} from '@/lib/sell-form';
import { radius, spacing, useTheme } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';
import { formCheck } from './form-check';

type Pin = { lat: number; lng: number };

/**
 * Where is the stock? / Where is the machine? (F2 spec §4.7, §5.2): the business address or another godown (pincode →
 * city and state, the pincode's industrial areas or Other, a private address line, an optional pin from the current
 * location), delivery options, and for rentals "Works within N km". Buyers see area, city and distance only.
 */
export default function StepLocation({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { listing } = ctx;
  const rental = listing.kind === 'machine_rental';
  const business = useBusiness();
  const stored = listing.location;
  const [pin, setPin] = useState<Pin | null>(
    stored.source === 'godown' && stored.lat != null && stored.lng != null ? { lat: stored.lat, lng: stored.lng } : null,
  );
  const [locating, setLocating] = useState(false);
  const storedPincode = stored.source === 'godown' ? stored.pincode : null;
  const filledFor = useRef<string | null>(storedPincode);
  /** The pincode the pin came with (`pinAfterPincode`, as F1). */
  const pinFor = useRef<string | null>(pin ? storedPincode : null);
  /** The pincode the picked industrial area belongs to: another pincode clears it. */
  const areaFor = useRef<string | null>(storedPincode);

  const form = useFormik<LocationValues>({
    initialValues: locationInitial(listing),
    validate: (v) => translateErrors(validateLocation(v, listing.kind), t),
    onSubmit: () => undefined,
  });
  const v = form.values;
  const err = (k: keyof LocationValues): string | undefined =>
    (form.submitCount > 0 || form.touched[k] ? (form.errors[k] as string | undefined) : undefined);
  const godown = v.source === 'godown';

  const digits = toAsciiDigits(v.pincode).trim();
  const validPin = godown && PINCODE_REGEX.test(digits) ? digits : null;
  const pincodeInfo = usePincodeInfo(validPin);
  const areas = useIndustrialAreas(validPin);

  // A pincode the pin didn't come with clears the pin; a pin that came with none binds to the first one (as F1). A
  // new pincode also clears the industrial area, which belongs to the old one.
  useEffect(() => {
    if (validPin && validPin !== areaFor.current) {
      areaFor.current = validPin;
      if (form.values.industrialAreaId) void form.setFieldValue('industrialAreaId', null);
    }
    if (!pin) return;
    const next = pinAfterPincode(pinFor.current, validPin);
    if (next === 'bind') pinFor.current = validPin;
    if (next === 'clear') {
      setPin(null);
      pinFor.current = null;
      Toast.show({ type: 'info', text1: t('onboarding.location.pinCleared') });
    }
    // Keyed on the pincode only.
  }, [validPin]); // eslint-disable-line react-hooks/exhaustive-deps

  // A newly typed pincode fills city and state (both stay editable), as F1.
  useEffect(() => {
    if (!validPin || pincodeInfo.data === undefined || filledFor.current === validPin) return;
    filledFor.current = validPin;
    if (pincodeInfo.data) {
      void form.setFieldValue('city', pincodeInfo.data.city);
      void form.setFieldValue('state', pincodeInfo.data.state);
    }
  }, [validPin, pincodeInfo.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The stored area stays pickable for its pincode after an admin deactivates it.
  const options = useMemo(() => {
    const list = (areas.data ?? []).map((a) => ({ id: a.id, name: a.name }));
    if (stored.source === 'godown' && stored.industrialAreaId && stored.industrialAreaName && validPin === stored.pincode
      && !list.some((a) => a.id === stored.industrialAreaId)) {
      list.push({ id: stored.industrialAreaId, name: stored.industrialAreaName });
    }
    return list;
  }, [areas.data, stored, validPin]);
  const onlyOther = validPin !== null && areas.data !== undefined && options.length === 0;
  const showOther = v.otherOpen || onlyOther;

  const locate = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Toast.show({ type: 'info', text1: t('onboarding.location.permissionDenied') });
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { lat: position.coords.latitude, lng: position.coords.longitude };
      setPin(here);
      const info = await fetchNearestPincode(here.lat, here.lng);
      // The pin belongs to the nearest office's pincode; with none nearby it binds to the next valid one typed.
      pinFor.current = info?.pincode ?? null;
      if (!info) {
        Toast.show({ type: 'info', text1: t('onboarding.location.noPincodeNearby') });
        return;
      }
      filledFor.current = info.pincode;
      areaFor.current = info.pincode;
      await form.setValues({ ...form.values, pincode: info.pincode, city: info.city, state: info.state, industrialAreaId: null });
      Toast.show({ type: 'success', text1: t('onboarding.location.found', { pincode: info.pincode }) });
    } catch {
      Toast.show({ type: 'error', text1: t('errors.genericRetry') });
    } finally {
      setLocating(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    choice: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl,
      borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface,
    },
    choiceOn: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
    well: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    choiceText: { flex: 1 },
    choiceTitle: { ...type('cardTitle'), color: colors.text },
    choiceSub: { ...type('caption'), color: colors.textSecondary, marginTop: 2 },
    radio: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 2, borderColor: colors.border },
    radioOn: { borderColor: colors.primary, borderWidth: 7 },
    row: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    pinText: { flex: 1, ...type('bodyStrong'), color: colors.text },
    hint: { ...type('caption'), color: colors.textMuted },
  }), [colors, type]);

  const bizLoc = business.data?.location;
  const bizLine = [bizLoc?.industrialAreaName ?? bizLoc?.industrialAreaOther, bizLoc?.city].filter(Boolean).join(', ');

  const choice = (source: 'business' | 'godown', title: string, sub: string, Icon: typeof MapPin) => {
    const on = v.source === source;
    return (
      <Pressable
        style={[s.choice, on && s.choiceOn]}
        onPress={() => void form.setFieldValue('source', source)}
        testID={`Sell-location-${source}`}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
      >
        <View style={s.well}><Icon size={22} color={colors.primaryInk} /></View>
        <View style={s.choiceText}>
          <Text style={s.choiceTitle}>{title}</Text>
          {sub ? <Text style={s.choiceSub}>{sub}</Text> : null}
        </View>
        <View style={[s.radio, on && s.radioOn]} />
      </Pressable>
    );
  };

  return (
    <StepFrame
      ctx={ctx}
      patch={() => locationPatch(v, godown ? pin : null, listing.kind)}
      validate={({ loose }) => (loose ? Object.keys(validateLocation(v, listing.kind)).length === 0 : formCheck(form))}
      nextLabel={ctx.mode === 'create' ? t('sell.previewListing') : undefined}
      title={t(listing.kind === 'part' ? 'sell.location.titleStock' : 'sell.location.titleMachine')}
    >
      {choice('business', t('sell.location.business'), bizLine, Building2)}
      {choice('godown', t('sell.location.godown'), t('sell.location.godownHint'), Package)}

      {godown ? (
        <>
          <Input
            label={t('onboarding.location.pincode')}
            placeholder={t('onboarding.location.pincodePlaceholder')}
            keyboardType="number-pad"
            maxLength={6}
            value={v.pincode}
            onChangeText={form.handleChange('pincode')}
            onBlur={form.handleBlur('pincode')}
            error={err('pincode')}
            testID="Sell-godown-pincode"
          />
          {validPin && pincodeInfo.data === null ? (
            <Notice tone="warning" icon={Info} text={t('onboarding.location.unknownPincode')} />
          ) : null}
          <View style={s.row}>
            <View style={s.half}>
              <Input label={t('onboarding.location.city')} value={v.city} onChangeText={form.handleChange('city')} error={err('city')} testID="Sell-godown-city" />
            </View>
            <View style={s.half}>
              <Input label={t('onboarding.location.state')} value={v.state} onChangeText={form.handleChange('state')} error={err('state')} testID="Sell-godown-state" />
            </View>
          </View>
          <Field label={t('onboarding.location.area')} hint={t('sell.optional')}>
            {!validPin ? (
              <Text style={s.hint}>{t('onboarding.location.areaEnterPincode')}</Text>
            ) : areas.isLoading ? (
              <Skeleton style={{ height: 96, borderRadius: radius.lg }} />
            ) : (
              <Card flush>
                {options.map((o) => {
                  const on = !showOther && v.industrialAreaId === o.id;
                  return (
                    <ListRow
                      key={o.id}
                      label={o.name}
                      selected={on}
                      onPress={() => void form.setValues({ ...v, industrialAreaId: on ? null : o.id, otherOpen: false, industrialAreaOther: '' })}
                      testID="Sell-godown-area-option"
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    />
                  );
                })}
                <ListRow
                  label={t('onboarding.location.other')}
                  selected={showOther}
                  last
                  onPress={() => void form.setValues({ ...v, industrialAreaId: null, otherOpen: true })}
                  testID="Sell-godown-area-other"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: showOther }}
                />
              </Card>
            )}
          </Field>
          {showOther ? (
            <Input
              placeholder={t('onboarding.location.otherPlaceholder')}
              value={v.industrialAreaOther}
              onChangeText={(text) => void form.setValues({ ...v, otherOpen: true, industrialAreaOther: text })}
              maxLength={AREA_OTHER_MAX}
              error={err('industrialAreaOther')}
              testID="Sell-godown-area-other-text"
            />
          ) : null}
          <Input
            label={t('sell.location.addressLine')}
            placeholder={t('onboarding.location.addressPlaceholder')}
            value={v.addressLine}
            onChangeText={form.handleChange('addressLine')}
            maxLength={ADDRESS_LINE_MAX}
            error={err('addressLine')}
            testID="Sell-godown-address"
          />
          <Text style={s.hint}>{t('sell.location.addressPrivate')}</Text>
          {pin ? (
            <View style={s.pinRow}>
              <MapPin size={18} color={colors.ok} />
              <Text style={s.pinText}>{t('onboarding.location.pinSet')}</Text>
              <Button title={t('onboarding.location.removePin')} phLabel="Sell-godown-remove-pin" variant="ghost" size="sm" icon={X} onPress={() => { setPin(null); pinFor.current = null; }} />
            </View>
          ) : null}
          <Button
            title={locating ? t('onboarding.location.locating') : t('onboarding.location.useMyLocation')}
            phLabel="Sell-godown-locate"
            variant="outline"
            icon={LocateFixed}
            disabled={locating}
            onPress={() => void locate()}
          />
        </>
      ) : null}

      <Field label={t('sell.location.delivery')} error={err('delivery')}>
        <View style={s.chips}>
          {DELIVERY_OPTIONS.map((d) => {
            const on = v.delivery.includes(d);
            return (
              <Chip
                key={d}
                label={deliveryLabel(d)}
                selected={on}
                onPress={() => void form.setFieldValue('delivery', on ? v.delivery.filter((x) => x !== d) : [...v.delivery, d])}
                testID={`Sell-delivery-${d}`}
              />
            );
          })}
        </View>
      </Field>
      {rental ? (
        <Input
          label={t('sell.location.worksWithin')}
          placeholder={t('sell.optional')}
          value={v.serviceRadius}
          onChangeText={form.handleChange('serviceRadius')}
          keyboardType="number-pad"
          maxLength={4}
          error={err('serviceRadius')}
          testID="Sell-works-within"
        />
      ) : null}
    </StepFrame>
  );
}
