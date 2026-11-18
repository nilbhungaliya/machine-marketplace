import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { checkFit, type Fitment } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import Notice from '@/components/Notice';
import { useBrands, useModels } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { CircleCheck, Info } from '@/lib/icons';
import { FIT_CHOICE_STORAGE_KEY, parseFitChoice, parseFitYear, serializeFitChoice } from '@/lib/listing-page';
import { spacing, useTheme } from '@/lib/theme';

interface CheckMyMachineSheetProps {
  visible: boolean;
  fitments: readonly Fitment[];
  onClose: () => void;
}

/** Brands shown at once while searching (the list scrolls inside the sheet). */
const BRANDS_SHOWN = 30;

/**
 * "Check my machine" (F2 spec §8.3, R21): machine brand → model (of any machine type) → year (optional), answered from
 * the listing's fitment rows by `checkFit`: "Seller says it fits" or "Not listed by the seller". Every row is
 * seller-declared, so the green "Fits your machine" badge never shows yet. The last choice is remembered on the device
 * and pre-selected next time. Tracks `listing_fit_checked { result }`.
 */
export default function CheckMyMachineSheet({ visible, fitments, onClose }: CheckMyMachineSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const brands = useBrands('machines');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [yearText, setYearText] = useState('');
  const [search, setSearch] = useState('');
  const [yearError, setYearError] = useState<string | undefined>();
  const [result, setResult] = useState<'fits' | 'not_listed' | null>(null);
  const models = useModels(brandId);

  const s = useMemo(() => StyleSheet.create({
    subtitle: { ...type('caption'), color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    empty: { ...type('caption'), color: colors.textMuted, padding: spacing.md },
  }), [colors, type]);

  // Pre-select the machine last checked on this device (a storage failure just starts empty).
  useEffect(() => {
    if (!visible) return;
    setResult(null);
    setYearError(undefined);
    let live = true;
    (async () => {
      try {
        const choice = parseFitChoice(await AsyncStorage.getItem(FIT_CHOICE_STORAGE_KEY));
        if (!live || !choice) return;
        setBrandId(choice.brandId);
        setModelId(choice.modelId);
        setYearText(choice.year != null ? String(choice.year) : '');
      } catch {
        // Not remembered: nothing to pre-select.
      }
    })();
    return () => { live = false; };
  }, [visible]);

  const brand = brands.data?.find((b) => b.id === brandId) ?? null;
  const shownBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (brands.data ?? []).filter((b) => q === '' || b.name.toLowerCase().includes(q)).slice(0, BRANDS_SHOWN);
  }, [brands.data, search]);

  const reset = () => setResult(null);

  const check = () => {
    if (!brand) return;
    const brandId = brand.id;
    const year = parseFitYear(yearText);
    if (!year.ok) {
      setYearError(t('listing.fitCheck.yearInvalid', { max: new Date().getFullYear() + 1 }));
      return;
    }
    setYearError(undefined);
    const answer = checkFit(fitments, { brandId, modelId, year: year.year });
    setResult(answer);
    track(LISTING_EVENTS.fitChecked, { result: answer });
    AsyncStorage.setItem(FIT_CHOICE_STORAGE_KEY, serializeFitChoice({ brandId, modelId, year: year.year })).catch(() => {
      // Remembering is a convenience; the answer is already shown.
    });
  };

  return (
    <ActionSheet visible={visible} title={t('listing.fitCheck.title')} items={[]} onSelect={() => {}} onClose={onClose}>
      <Text style={s.subtitle}>{t('listing.fitCheck.subtitle')}</Text>

      <Field label={t('listing.fitCheck.brand')}>
        {brand ? (
          <Card flush>
            <ListRow
              label={brand.name}
              trailing={(
                <Button
                  title={t('listing.fitCheck.change')}
                  onPress={() => { setBrandId(null); setModelId(null); reset(); }}
                  variant="ghost"
                  size="sm"
                  phLabel="Fit-check-change-brand"
                />
              )}
              last
              testID="Fit-check-brand"
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder={t('listing.fitCheck.brandSearch')}
              accessibilityLabel={t('listing.fitCheck.brandSearch')}
              testID="Fit-check-brand-search"
            />
            <Card flush>
              {brands.isError ? (
                <Text style={s.empty}>{t('listing.fitCheck.loadError')}</Text>
              ) : shownBrands.length === 0 && !brands.isLoading ? (
                <Text style={s.empty}>{t('listing.fitCheck.noBrands')}</Text>
              ) : (
                shownBrands.map((b, i) => (
                  <ListRow
                    key={b.id}
                    label={b.name}
                    last={i === shownBrands.length - 1}
                    onPress={() => { setBrandId(b.id); setModelId(null); setSearch(''); reset(); }}
                    testID={`Fit-check-brand-${b.key}`}
                    accessibilityRole="button"
                  />
                ))
              )}
            </Card>
          </View>
        )}
      </Field>

      {brand ? (
        <Field label={t('listing.fitCheck.model')}>
          <View style={s.chips}>
            {(models.data ?? []).map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                role="radio"
                selected={modelId === m.id}
                onPress={() => { setModelId(m.id); reset(); }}
                testID={`Fit-check-model-${m.key}`}
              />
            ))}
            <Chip
              label={t('listing.fitCheck.modelOther')}
              role="radio"
              selected={modelId === null}
              onPress={() => { setModelId(null); reset(); }}
              testID="Fit-check-model-other"
            />
          </View>
        </Field>
      ) : null}

      {brand ? (
        <Input
          label={t('listing.fitCheck.year')}
          value={yearText}
          onChangeText={(v) => { setYearText(v); reset(); }}
          keyboardType="number-pad"
          maxLength={4}
          error={yearError}
          testID="Fit-check-year"
        />
      ) : null}

      {result === 'fits' ? (
        <Notice tone="success" icon={CircleCheck} title={t('listing.fitCheck.fits')} text={t('listing.fitCheck.fitsBody')} />
      ) : result === 'not_listed' ? (
        <Notice tone="info" icon={Info} title={t('listing.fitCheck.notListed')} text={t('listing.fitCheck.notListedBody')} />
      ) : null}

      <Button title={t('listing.fitCheck.check')} onPress={check} disabled={!brand} phLabel="Fit-check-submit" />
    </ActionSheet>
  );
}
