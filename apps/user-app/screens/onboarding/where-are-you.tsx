import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import Toast from 'react-native-toast-message';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import type { BusinessProfile } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { businessKeys, useBusiness, useIndustrialAreas, usePincodeInfo } from '@/hooks/use-business';
import { AUTH_EVENTS, track } from '@/lib/analytics';
import { ONBOARDING_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { fetchNearestPincode, saveLocation } from '@/lib/business-api';
import { toAsciiDigits } from '@/lib/digits';
import { Check, Info, LocateFixed, MapPin, Search, X } from '@/lib/icons';
import {
  buildLocationSchema, PINCODE_REGEX, pinAfterPincode, toLocationBody, type FormMode, type LocationFormValues,
} from '@/lib/onboarding-step';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import type { Pin } from './location-map';

const mapsEnabled = Constants.expoConfig?.extra?.mapsEnabled === true;
// Loaded only with a maps key: react-native-maps' Android view crashes without one (F1 spec §4.2).
const LocationMap: typeof import('./location-map').default | null = mapsEnabled ? require('./location-map').default : null;

/** Show a search box above the industrial-area list once it is longer than this. */
const SEARCH_FROM = 7;

/** F1 "Where are you?": onboarding step 2, or Profile → Location (`mode: 'edit'`). Spec §4.2, §7. */
export default function WhereAreYouScreen({ navigation, route }: RootStackScreenProps<'WhereAreYou'>) {
  const mode = route.params?.mode ?? 'onboarding';
  const { t } = useTranslation();
  const business = useBusiness();
  const title = mode === 'edit' ? t('onboarding.location.editTitle') : t('onboarding.location.title');

  if (business.isLoading) {
    return (
      <ScreenWrapper>
        <Header title={title} showBack={mode === 'edit'} />
        <View style={{ paddingHorizontal: spacing.xxl, gap: spacing.lg, paddingTop: spacing.lg }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 52, borderRadius: radius.lg }} />)}
        </View>
      </ScreenWrapper>
    );
  }
  // Mounted once the saved location is known, so the form starts from it.
  return (
    <LocationForm
      mode={mode}
      title={title}
      profile={business.data ?? null}
      onDone={() => navigation.goBack()}
    />
  );
}

function LocationForm({ mode, title, profile, onDone }: {
  mode: FormMode; title: string; profile: BusinessProfile | null; onDone: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { applyProfile } = useAuth();
  const saved = profile?.location ?? null;

  // The saved pin starts the form: PUT /businesses/me/location replaces everything, so an edit sends it back (and keeps
  // it) unless the user removes it or types a pincode it didn't come with.
  const [pin, setPin] = useState<Pin | null>(saved?.lat != null && saved.lng != null ? { lat: saved.lat, lng: saved.lng } : null);
  /** The pincode the pin came with (`pinAfterPincode`). */
  const pinFor = useRef<string | null>(saved?.pincode ?? null);
  const [otherOpen, setOtherOpen] = useState(!!saved?.industrialAreaOther);
  const [areaQuery, setAreaQuery] = useState('');
  const [locating, setLocating] = useState(false);
  // The pincode whose city and state were last filled in: the saved one counts, so edits to them survive.
  const filledFor = useRef<string | null>(saved?.pincode ?? null);

  const schema = useMemo(() => buildLocationSchema(t), [t]);
  const form = useFormik<LocationFormValues>({
    initialValues: {
      pincode: saved?.pincode ?? '',
      city: saved?.city ?? '',
      state: saved?.state ?? '',
      industrialAreaId: saved?.industrialAreaId ?? null,
      industrialAreaOther: saved?.industrialAreaOther ?? '',
      addressLine: saved?.addressLine ?? '',
    },
    validationSchema: schema,
    onSubmit: async (values, helpers) => {
      try {
        const updated = await saveLocation(toLocationBody(values, pin));
        track(ONBOARDING_EVENTS.locationSaved, { mode, area: values.industrialAreaId ? 'listed' : 'other', pin: pin !== null });
        if (mode === 'onboarding') track(AUTH_EVENTS.onboardingCompleted);
        // Onboarding: `done` moves the root navigator on (the GST intro once, then the tabs).
        await applyProfile(updated);
        if (mode === 'edit') {
          Toast.show({ type: 'success', text1: t('onboarding.location.saved') });
          onDone();
        }
      } catch (err) {
        const code = errorCode(err);
        track(ONBOARDING_EVENTS.locationSaveFailed, { mode, reason: code });
        if (code === 'AREA_MISMATCH') {
          // The list changed under us (or the pincode moved district): pick again from a fresh list.
          await helpers.setFieldValue('industrialAreaId', null, false);
          void areas.refetch();
          helpers.setFieldError('industrialAreaId', t('onboarding.errors.areaMismatch'));
          return;
        }
        if (code === 'NO_BUSINESS') {
          Toast.show({ type: 'error', text1: t('onboarding.errors.noBusiness') });
          return;
        }
        Toast.show({ type: 'error', text1: t(errorKey(err, {})) });
      }
    },
  });

  const pincodeDigits = toAsciiDigits(form.values.pincode).trim();
  const validPin = PINCODE_REGEX.test(pincodeDigits) ? pincodeDigits : null;
  const pincodeInfo = usePincodeInfo(validPin);
  const areas = useIndustrialAreas(validPin);

  // A pincode the pin didn't come with clears the pin; a pin that came with none binds to the first one.
  useEffect(() => {
    if (!pin) return;
    const next = pinAfterPincode(pinFor.current, validPin);
    if (next === 'bind') pinFor.current = validPin;
    if (next === 'clear') {
      setPin(null);
      pinFor.current = null;
      track(ONBOARDING_EVENTS.locationPinCleared, { reason: 'pincode_changed' });
      Toast.show({ type: 'info', text1: t('onboarding.location.pinCleared') });
    }
    // Keyed on the pincode only.
  }, [validPin]);

  const removePin = () => {
    setPin(null);
    pinFor.current = null;
    track(ONBOARDING_EVENTS.locationPinCleared, { reason: 'removed' });
  };

  // A newly typed pincode fills city and state (both stay editable).
  useEffect(() => {
    if (!validPin || pincodeInfo.data === undefined || filledFor.current === validPin) return;
    filledFor.current = validPin;
    if (pincodeInfo.data) {
      void form.setFieldValue('city', pincodeInfo.data.city);
      void form.setFieldValue('state', pincodeInfo.data.state);
    }
    // Keyed on the lookup only: `form` changes every render.
  }, [validPin, pincodeInfo.data]);

  // The saved area stays pickable after an admin deactivates it (spec §4.3), for the same pincode.
  const options = useMemo(() => {
    const list = (areas.data ?? []).map((a) => ({ id: a.id, name: a.name }));
    const kept = saved?.industrialAreaId && saved.industrialAreaName && validPin === saved.pincode
      ? { id: saved.industrialAreaId, name: saved.industrialAreaName } : null;
    if (kept && !list.some((a) => a.id === kept.id)) list.push(kept);
    return list;
  }, [areas.data, saved, validPin]);

  // A picked area that isn't in the new pincode's list is cleared.
  useEffect(() => {
    if (!areas.data) return;
    const id = form.values.industrialAreaId;
    if (id && !options.some((o) => o.id === id)) void form.setFieldValue('industrialAreaId', null);
  }, [options]);

  const onlyOther = validPin !== null && areas.data !== undefined && options.length === 0;
  const showOther = otherOpen || onlyOther;

  // "Other" closed by itself (the new pincode has areas to pick from): its hidden text must not be saved.
  useEffect(() => {
    if (!showOther && form.values.industrialAreaOther !== '') void form.setFieldValue('industrialAreaOther', '');
  }, [showOther]);
  const query = areaQuery.trim().toLowerCase();
  const shown = query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options;

  const pickArea = (id: string) => {
    void form.setFieldValue('industrialAreaId', id);
    void form.setFieldValue('industrialAreaOther', '');
    setOtherOpen(false);
  };
  const pickOther = () => {
    void form.setFieldValue('industrialAreaId', null);
    setOtherOpen(true);
  };

  const locate = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        track(ONBOARDING_EVENTS.locationDetectFailed, { reason: 'permission' });
        Toast.show({ type: 'info', text1: t('onboarding.location.permissionDenied') });
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { lat: position.coords.latitude, lng: position.coords.longitude };
      const info = await fetchNearestPincode(here.lat, here.lng);
      // Bound before the pincode changes, so the effect above keeps this pin. With no office nearby it belongs to the
      // pincode already typed, or the one typed next.
      pinFor.current = info?.pincode ?? validPin;
      setPin(here);
      if (!info) {
        track(ONBOARDING_EVENTS.locationDetectFailed, { reason: 'no_pincode' });
        Toast.show({ type: 'info', text1: t('onboarding.location.noPincodeNearby') });
        return;
      }
      queryClient.setQueryData(businessKeys.pincode(info.pincode), info);
      filledFor.current = info.pincode;
      await form.setFieldValue('pincode', info.pincode);
      await form.setFieldValue('city', info.city);
      await form.setFieldValue('state', info.state);
      track(ONBOARDING_EVENTS.locationDetected);
      Toast.show({ type: 'success', text1: t('onboarding.location.found', { pincode: info.pincode }) });
    } catch (err) {
      track(ONBOARDING_EVENTS.locationDetectFailed, { reason: errorCode(err) });
      Toast.show({ type: 'error', text1: t(errorKey(err, {})) });
    } finally {
      setLocating(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
    step: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
    map: { height: 180, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm },
    mapHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
    locate: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48,
      borderRadius: radius.full, backgroundColor: colors.primaryWash,
    },
    locateText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },
    row: { flexDirection: 'row', gap: spacing.md },
    pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, minHeight: 44 },
    pinText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    pinRemove: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
    pinRemoveText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary },
    half: { flex: 1 },
    notice: {
      flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md,
      backgroundColor: colors.warnSoft, marginTop: spacing.sm,
    },
    noticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.text },
    label: {
      fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8,
      marginTop: spacing.xl, marginBottom: spacing.xs,
    },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
    list: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
    option: {
      flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
    },
    optionLast: { borderBottomWidth: 0 },
    optionSelected: { backgroundColor: colors.primaryWash },
    optionText: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    optionTextSelected: { color: colors.primary, fontFamily: fonts.semiBold },
    empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, padding: spacing.lg },
    error: { fontFamily: fonts.regular, fontSize: 12, color: colors.danger, marginTop: spacing.sm },
    retry: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, paddingTop: spacing.sm },
  }), [colors]);

  const fieldError = (k: 'pincode' | 'city' | 'state' | 'industrialAreaOther' | 'addressLine') =>
    form.touched[k] || form.submitCount > 0 ? form.errors[k] : undefined;
  const areaError = form.submitCount > 0 || form.touched.industrialAreaId ? form.errors.industrialAreaId : undefined;

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={title} showBack={mode === 'edit'} />
      <View style={s.body}>
        {mode === 'onboarding' ? (
          <>
            <Text style={s.step}>{t('onboarding.step', { current: 2, total: 2 })}</Text>
            <Text style={s.subtitle}>{t('onboarding.location.subtitle')}</Text>
          </>
        ) : null}

        {LocationMap && pin ? (
          <>
            <LocationMap pin={pin} onChange={setPin} style={s.map} />
            <Text style={s.mapHint}>{t('onboarding.location.mapHint')}</Text>
          </>
        ) : null}

        {pin ? (
          <View style={s.pinRow}>
            <MapPin size={16} color={colors.ok} />
            <Text style={s.pinText}>{t('onboarding.location.pinSet')}</Text>
            <Pressable
              onPress={removePin}
              hitSlop={12}
              style={s.pinRemove}
              testID="Remove-location-pin"
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.location.removePin')}
            >
              <X size={14} color={colors.primary} />
              <Text style={s.pinRemoveText}>{t('onboarding.location.removePin')}</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          style={s.locate}
          onPress={() => void locate()}
          disabled={locating}
          testID="Use-my-location"
          accessibilityRole="button"
          accessibilityState={{ busy: locating }}
        >
          {locating ? <ActivityIndicator color={colors.primary} /> : <LocateFixed size={18} color={colors.primary} />}
          <Text style={s.locateText}>{locating ? t('onboarding.location.locating') : t('onboarding.location.useMyLocation')}</Text>
        </Pressable>

        <Input
          label={t('onboarding.location.pincode')}
          placeholder={t('onboarding.location.pincodePlaceholder')}
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="postal-code"
          value={form.values.pincode}
          onChangeText={form.handleChange('pincode')}
          onBlur={form.handleBlur('pincode')}
          error={fieldError('pincode')}
          testID="Pincode"
        />
        {validPin && pincodeInfo.data === null ? (
          <View style={s.notice}>
            <Info size={16} color={colors.warn} />
            <Text style={s.noticeText}>{t('onboarding.location.unknownPincode')}</Text>
          </View>
        ) : null}

        <View style={s.row}>
          <View style={s.half}>
            <Input
              label={t('onboarding.location.city')}
              value={form.values.city}
              onChangeText={form.handleChange('city')}
              onBlur={form.handleBlur('city')}
              error={fieldError('city')}
              testID="City"
            />
          </View>
          <View style={s.half}>
            <Input
              label={t('onboarding.location.state')}
              value={form.values.state}
              onChangeText={form.handleChange('state')}
              onBlur={form.handleBlur('state')}
              error={fieldError('state')}
              testID="State"
            />
          </View>
        </View>

        <Text style={s.label}>{t('onboarding.location.area')}</Text>
        <Text style={s.hint}>{t('onboarding.location.areaHint')}</Text>
        {!validPin ? (
          <Text style={s.hint}>{t('onboarding.location.areaEnterPincode')}</Text>
        ) : areas.isLoading ? (
          <Skeleton style={{ height: 144, borderRadius: radius.lg }} />
        ) : areas.isError ? (
          <Pressable onPress={() => void areas.refetch()} testID="Retry-industrial-areas" accessibilityRole="button">
            <Text style={s.hint}>{t('onboarding.location.areasError')}</Text>
            <Text style={s.retry}>{t('common.retry')}</Text>
          </Pressable>
        ) : (
          <>
            {options.length >= SEARCH_FROM ? (
              <Input
                placeholder={t('onboarding.location.areaSearch')}
                value={areaQuery}
                onChangeText={setAreaQuery}
                autoCorrect={false}
                testID="Search-industrial-areas"
                style={{ marginBottom: spacing.sm }}
              />
            ) : null}
            <View style={s.list}>
              {shown.map((o) => {
                const selected = form.values.industrialAreaId === o.id;
                return (
                  <Pressable
                    key={o.id}
                    style={[s.option, selected && s.optionSelected]}
                    onPress={() => pickArea(o.id)}
                    testID="Industrial-area-option"
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[s.optionText, selected && s.optionTextSelected]}>{o.name}</Text>
                    {selected ? <Check size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
              {query && shown.length === 0 ? (
                <View style={[s.option, { gap: spacing.sm }]}>
                  <Search size={16} color={colors.textMuted} />
                  <Text style={[s.empty, { padding: 0, flex: 1 }]}>{t('onboarding.location.areaNoMatch')}</Text>
                </View>
              ) : null}
              <Pressable
                style={[s.option, s.optionLast, showOther && s.optionSelected]}
                onPress={pickOther}
                testID="Industrial-area-other"
                accessibilityRole="radio"
                accessibilityState={{ selected: showOther }}
              >
                <Text style={[s.optionText, showOther && s.optionTextSelected]}>{t('onboarding.location.other')}</Text>
                {showOther ? <Check size={18} color={colors.primary} /> : null}
              </Pressable>
            </View>
            {showOther ? (
              <Input
                placeholder={t('onboarding.location.otherPlaceholder')}
                value={form.values.industrialAreaOther}
                onChangeText={form.handleChange('industrialAreaOther')}
                onBlur={form.handleBlur('industrialAreaOther')}
                error={fieldError('industrialAreaOther')}
                maxLength={80}
                testID="Industrial-area-other-text"
              />
            ) : null}
          </>
        )}
        {areaError ? <Text style={s.error}>{areaError}</Text> : null}

        <Input
          label={t('onboarding.location.address')}
          placeholder={t('onboarding.location.addressPlaceholder')}
          value={form.values.addressLine}
          onChangeText={form.handleChange('addressLine')}
          onBlur={form.handleBlur('addressLine')}
          error={fieldError('addressLine')}
          maxLength={200}
          testID="Address-line"
        />
      </View>
      <View style={s.footer}>
        <Button
          title={mode === 'edit' ? t('onboarding.business.saveChanges') : t('onboarding.location.save')}
          phLabel={mode === 'edit' ? 'Save-location' : 'Onboarding-location-save'}
          loading={form.isSubmitting}
          onPress={() => form.handleSubmit()}
        />
      </View>
    </ScreenWrapper>
  );
}
