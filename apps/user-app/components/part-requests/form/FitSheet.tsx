import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartRequestKind } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import { useBrands, useModels } from '@/hooks/use-listing';
import { toAsciiDigits } from '@/lib/digits';
import { ChevronLeft, Search } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import type { FormFit } from '@/lib/part-request-form';
import { spacing } from '@/lib/theme';
import { PickerField, SellSheet } from '@/screens/sell/sell-sheet';

const YEAR_MIN = 1950;
const SEARCH_FROM = 8;

const yearOf = (text: string): number | null | 'invalid' => {
  const clean = toAsciiDigits(text).trim();
  if (clean === '') return null;
  return /^\d{4}$/.test(clean) ? Number(clean) : 'invalid';
};

/**
 * "+ Add a machine" / "+ Add make and model" (F8 spec §5.2, §13.1): a machine brand, a model of that brand or "All
 * models", and an optional year range. Shaped like the sell wizard's fit sheet, without "Other model" text or a note
 * (a request's fits are catalogue ids only, §25 item 6). A machine request lists only models of its machine type.
 */
export default function FitSheet({ visible, kind, machineTypeId, onAdd, onClose }: {
  visible: boolean;
  kind: PartRequestKind;
  /** The request's machine type (a part group's parent, or the type itself): its brands and models first. */
  machineTypeId: string | null;
  onAdd: (fit: FormFit) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nextYear = Number(istDateKey().slice(0, 4)) + 1;
  const [brandId, setBrandId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [view, setView] = useState<'form' | 'brand' | 'model'>('form');
  const [query, setQuery] = useState('');
  const [tried, setTried] = useState(false);
  const brands = useBrands('machines', machineTypeId);
  const models = useModels(brandId, kind === 'machine' ? machineTypeId : null);

  useEffect(() => {
    if (!visible) return;
    setBrandId(null);
    setModelId(null);
    setYearFrom('');
    setYearTo('');
    setView('form');
    setTried(false);
  }, [visible]);
  useEffect(() => setQuery(''), [view]);

  const brand = brands.data?.find((b) => b.id === brandId) ?? null;
  const model = models.data?.find((m) => m.id === modelId) ?? null;
  const modelRows = useMemo(() => {
    const all = (models.data ?? []).filter((m) => m.isActive);
    return [...all.filter((m) => m.machineTypeId === machineTypeId), ...all.filter((m) => m.machineTypeId !== machineTypeId)];
  }, [models.data, machineTypeId]);

  const from = yearOf(yearFrom);
  const to = yearOf(yearTo);
  const badYear = (y: number | null | 'invalid') => y === 'invalid' || (y !== null && (y < YEAR_MIN || y > nextYear));
  const errors = {
    brand: !brandId ? t('requirements.fit.errors.brand') : undefined,
    yearFrom: badYear(from) ? t('requirements.fit.errors.year', { min: YEAR_MIN, max: nextYear }) : undefined,
    yearTo: badYear(to)
      ? t('requirements.fit.errors.year', { min: YEAR_MIN, max: nextYear })
      : typeof from === 'number' && typeof to === 'number' && from > to ? t('requirements.fit.errors.order') : undefined,
  };
  const shown: Partial<typeof errors> = tried ? errors : {};

  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
  }), []);

  const add = () => {
    setTried(true);
    if (errors.brand || errors.yearFrom || errors.yearTo) return;
    onAdd({
      brandId: brandId!,
      brandName: brand?.name ?? null,
      modelId,
      modelName: model?.name ?? null,
      yearFrom: typeof from === 'number' ? from : null,
      yearTo: typeof to === 'number' ? to : null,
    });
    onClose();
  };

  const q = query.trim().toLowerCase();
  const list = (rows: { id: string; name: string }[], picked: string | null, onPick: (id: string) => void, { testID }: { testID: string }) => {
    const filtered = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
    return (
      <Card flush>
        {filtered.map((r, i) => (
          <ListRow
            key={r.id}
            label={r.name}
            selected={r.id === picked}
            last={i === filtered.length - 1}
            onPress={() => onPick(r.id)}
            testID={testID}
            accessibilityRole="radio"
            accessibilityState={{ selected: r.id === picked }}
          />
        ))}
        {filtered.length === 0 ? <ListRow icon={Search} label={t('requirements.category.noMatch')} last /> : null}
      </Card>
    );
  };

  const back = (
    <Card flush>
      <ListRow icon={ChevronLeft} label={t('requirements.fit.back')} onPress={() => setView('form')} last testID="Request-fit-back" />
    </Card>
  );
  const title = kind === 'machine' ? t('requirements.fit.titleMachine') : t('requirements.fit.title');

  return (
    <SellSheet
      visible={visible}
      title={view === 'brand' ? t('requirements.fit.brand') : view === 'model' ? t('requirements.fit.model') : title}
      onClose={onClose}
      testID="Request-fit-sheet"
      footer={view === 'form' ? <View style={s.half}><Button title={t('requirements.fit.add')} phLabel="Request-fit-add" size="md" onPress={add} /></View> : undefined}
    >
      {view === 'brand' ? (
        <>
          {back}
          {(brands.data?.length ?? 0) >= SEARCH_FROM ? (
            <Input placeholder={t('requirements.fit.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID="Request-fit-brand-search" />
          ) : null}
          {list((brands.data ?? []).map((b) => ({ id: b.id, name: b.name })), brandId, (id) => {
            setBrandId(id);
            setModelId(null);
            setView('form');
          }, { testID: 'Request-fit-brand-option' })}
        </>
      ) : view === 'model' ? (
        <>
          {back}
          <Card flush>
            <ListRow
              label={t('requirements.fit.allModels')}
              selected={modelId === null}
              last
              onPress={() => { setModelId(null); setView('form'); }}
              testID="Request-fit-all-models"
              accessibilityRole="radio"
              accessibilityState={{ selected: modelId === null }}
            />
          </Card>
          {modelRows.length >= SEARCH_FROM ? (
            <Input placeholder={t('requirements.fit.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID="Request-fit-model-search" />
          ) : null}
          {modelRows.length > 0 ? list(modelRows, modelId, (id) => { setModelId(id); setView('form'); }, { testID: 'Request-fit-model-option' }) : null}
        </>
      ) : (
        <>
          <PickerField
            label={t('requirements.fit.brand')}
            value={brand?.name ?? null}
            placeholder={t('requirements.fit.pickBrand')}
            error={shown.brand}
            onPress={() => setView('brand')}
            testID="Request-fit-brand"
          />
          <PickerField
            label={t('requirements.fit.model')}
            value={modelId ? (model?.name ?? null) : t('requirements.fit.allModels')}
            placeholder={t('requirements.fit.allModels')}
            disabled={!brandId}
            onPress={() => setView('model')}
            testID="Request-fit-model"
          />
          <View style={s.row}>
            <View style={s.half}>
              <Input
                label={t('requirements.fit.yearFrom')}
                placeholder={t('requirements.form.optional')}
                value={yearFrom}
                onChangeText={setYearFrom}
                keyboardType="number-pad"
                maxLength={4}
                error={shown.yearFrom}
                testID="Request-fit-year-from"
              />
            </View>
            <View style={s.half}>
              <Input
                label={t('requirements.fit.yearTo')}
                placeholder={t('requirements.form.optional')}
                value={yearTo}
                onChangeText={setYearTo}
                keyboardType="number-pad"
                maxLength={4}
                error={shown.yearTo}
                testID="Request-fit-year-to"
              />
            </View>
          </View>
        </>
      )}
    </SellSheet>
  );
}
