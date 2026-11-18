import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Fitment } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { FieldLabel } from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import { useBrands, useModels } from '@/hooks/use-listing';
import { ChevronLeft, Search } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import {
  FIT_NOTE_MAX, fitRowPatch, MACHINE_OTHER_MAX, translateErrors, validateFitRow, type FitRowValues,
} from '@/lib/sell-form';
import { spacing } from '@/lib/theme';
import { PickerField, SellSheet } from './sell-sheet';

/** A fitment row as the fit step shows it: the PATCH fields plus the names for the chip. */
export type FitRowItem = Pick<Fitment, 'brandId' | 'brandName' | 'modelId' | 'modelName' | 'modelOther' | 'yearFrom' | 'yearTo' | 'note'>;

const EMPTY: FitRowValues = { brandId: null, modelMode: 'all', modelId: null, modelOther: '', yearFrom: '', yearTo: '', note: '' };

const SEARCH_FROM = 8;

/**
 * "+ Add machine" (F2 spec §5.2 fit step, §4.3, R37): a machine brand (those with models of the listing's machine type
 * first), then a model — the brand's models of this machine type first, then "Other machine types", plus "Other
 * model…" and "All models" — years from / to and a note. Brand and model lists open inside the same sheet.
 */
export default function FitRowSheet({ visible, machineTypeId, onAdd, onClose }: {
  visible: boolean;
  machineTypeId: string | null;
  onAdd: (row: FitRowItem) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const thisYear = Number(istDateKey().slice(0, 4));
  const [v, setV] = useState<FitRowValues>(EMPTY);
  const [view, setView] = useState<'form' | 'brand' | 'model'>('form');
  const [query, setQuery] = useState('');
  const [tried, setTried] = useState(false);
  const brands = useBrands('machines', machineTypeId);
  const models = useModels(v.brandId, null);

  useEffect(() => {
    if (!visible) return;
    setV(EMPTY);
    setView('form');
    setTried(false);
  }, [visible]);
  useEffect(() => setQuery(''), [view]);

  const errors = tried ? translateErrors(validateFitRow(v, thisYear), t) : {};
  const brand = brands.data?.find((b) => b.id === v.brandId) ?? null;
  const model = models.data?.find((m) => m.id === v.modelId) ?? null;

  const modelRows = useMemo(() => {
    const all = models.data ?? [];
    const own = all.filter((m) => m.machineTypeId === machineTypeId);
    const others = all.filter((m) => m.machineTypeId !== machineTypeId);
    return { own, others };
  }, [models.data, machineTypeId]);

  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    gap: { gap: spacing.sm },
  }), []);

  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const add = () => {
    setTried(true);
    if (Object.keys(validateFitRow(v, thisYear)).length > 0) return;
    const row = fitRowPatch(v);
    onAdd({ ...row, brandName: brand?.name ?? '', modelName: model?.name ?? null });
    onClose();
  };

  const listView = (rows: { id: string; name: string }[], picked: string | null, onPick: (id: string) => void, { testID }: { testID: string }) => {
    const shown = rows.filter((r) => match(r.name));
    return (
      <>
        {shown.map((r, i) => (
          <ListRow
            key={r.id}
            label={r.name}
            selected={r.id === picked}
            last={i === shown.length - 1}
            onPress={() => onPick(r.id)}
            testID={testID}
            accessibilityRole="radio"
            accessibilityState={{ selected: r.id === picked }}
          />
        ))}
        {q && shown.length === 0 ? <ListRow icon={Search} label={t('sell.picker.noMatch')} last /> : null}
      </>
    );
  };

  const back = (
    <Card flush>
      <ListRow icon={ChevronLeft} label={t('sell.fit.backToMachine')} onPress={() => setView('form')} last testID="Sell-fit-sheet-back" />
    </Card>
  );

  return (
    <SellSheet
      visible={visible}
      title={view === 'brand' ? t('sell.fit.brand') : view === 'model' ? t('sell.fit.model') : t('sell.fit.addMachine')}
      onClose={onClose}
      testID="Sell-fit-sheet"
      footer={view === 'form' ? <View style={s.half}><Button title={t('sell.fit.add')} phLabel="Sell-fit-add" size="md" onPress={add} /></View> : undefined}
    >
      {view === 'brand' ? (
        <>
          {back}
          {(brands.data?.length ?? 0) >= SEARCH_FROM ? (
            <Input placeholder={t('sell.picker.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID="Sell-fit-brand-search" />
          ) : null}
          <Card flush>
            {listView((brands.data ?? []).map((b) => ({ id: b.id, name: b.name })), v.brandId, (id) => {
              setV({ ...v, brandId: id, modelMode: 'all', modelId: null, modelOther: '' });
              setView('form');
            }, { testID: 'Sell-fit-brand-option' })}
          </Card>
        </>
      ) : view === 'model' ? (
        <>
          {back}
          {(models.data?.length ?? 0) >= SEARCH_FROM ? (
            <Input placeholder={t('sell.picker.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID="Sell-fit-model-search" />
          ) : null}
          <Card flush>
            <ListRow
              label={t('sell.fit.allModels')}
              selected={v.modelMode === 'all'}
              onPress={() => { setV({ ...v, modelMode: 'all', modelId: null }); setView('form'); }}
              testID="Sell-fit-all-models"
            />
            <ListRow
              label={t('sell.fit.otherModel')}
              selected={v.modelMode === 'other'}
              last
              onPress={() => { setV({ ...v, modelMode: 'other', modelId: null }); setView('form'); }}
              testID="Sell-fit-other-model"
            />
          </Card>
          {modelRows.own.length > 0 ? (
            <Card flush>
              {listView(modelRows.own, v.modelId, (id) => { setV({ ...v, modelMode: 'catalogue', modelId: id }); setView('form'); }, { testID: 'Sell-fit-model-option' })}
            </Card>
          ) : null}
          {modelRows.others.length > 0 ? (
            <View style={s.gap}>
              <FieldLabel>{t('sell.fit.otherTypes')}</FieldLabel>
              <Card flush>
                {listView(modelRows.others, v.modelId, (id) => { setV({ ...v, modelMode: 'catalogue', modelId: id }); setView('form'); }, { testID: 'Sell-fit-model-option' })}
              </Card>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <PickerField
            label={t('sell.fit.brand')}
            value={brand?.name ?? null}
            placeholder={t('sell.fit.pickBrand')}
            error={errors.brandId}
            onPress={() => setView('brand')}
            testID="Sell-fit-brand"
          />
          <PickerField
            label={t('sell.fit.model')}
            value={v.modelMode === 'all' ? t('sell.fit.allModels') : v.modelMode === 'other' ? t('sell.fit.otherModel') : model?.name ?? null}
            placeholder={t('sell.fit.pickModel')}
            error={errors.modelId}
            disabled={!v.brandId}
            onPress={() => setView('model')}
            testID="Sell-fit-model"
          />
          {v.modelMode === 'other' ? (
            <Input
              label={t('sell.fit.modelOther')}
              value={v.modelOther}
              onChangeText={(text) => setV({ ...v, modelOther: text })}
              maxLength={MACHINE_OTHER_MAX}
              error={errors.modelOther}
              testID="Sell-fit-model-other"
            />
          ) : null}
          <View style={s.row}>
            <View style={s.half}>
              <Input
                label={t('sell.fit.yearFrom')}
                placeholder={t('sell.optional')}
                value={v.yearFrom}
                onChangeText={(text) => setV({ ...v, yearFrom: text })}
                keyboardType="number-pad"
                maxLength={4}
                error={errors.yearFrom}
                testID="Sell-fit-year-from"
              />
            </View>
            <View style={s.half}>
              <Input
                label={t('sell.fit.yearTo')}
                placeholder={t('sell.optional')}
                value={v.yearTo}
                onChangeText={(text) => setV({ ...v, yearTo: text })}
                keyboardType="number-pad"
                maxLength={4}
                error={errors.yearTo}
                testID="Sell-fit-year-to"
              />
            </View>
          </View>
          <Input
            label={t('sell.fit.note')}
            placeholder={t('sell.fit.notePlaceholder')}
            value={v.note}
            onChangeText={(text) => setV({ ...v, note: text })}
            maxLength={FIT_NOTE_MAX}
            error={errors.note}
            testID="Sell-fit-note"
          />
        </>
      )}
    </SellSheet>
  );
}

