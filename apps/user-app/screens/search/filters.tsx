import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  cleanFilters, DISCOVERY_RADII_KM, MIN_QTY_STEPS, type DiscoveryRadiusKm, type SearchFilters, type SearchSide,
  type SpecFacet,
} from '@mpm/shared-types';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import Input from '@/components/Input';
import ScreenWrapper from '@/components/ScreenWrapper';
import SideToken from '@/components/SideToken';
import { useCountOnly } from '@/hooks/use-discover';
import { useBrands, useMasterData, useModels } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { SEARCH_EVENTS } from '@/lib/analytics-events';
import { toAsciiDigits } from '@/lib/digits';
import { videoUploadEnabled } from '@/lib/media-prepare';
import { parseRupees, rupeesInput } from '@/lib/money';
import { countFilters } from '@/lib/search-filters';
import { clearAllFilters, footerCopy, rentalsOnly, withFilters } from '@/lib/search-request';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import { PickerField, PickerSheet } from '@/screens/sell/sell-sheet';

const SIDES: SearchSide[] = ['left', 'right', 'pair'];
const RADII: Array<DiscoveryRadiusKm | null> = [...DISCOVERY_RADII_KM, null];

/** Typed number text (Hindi / Gujarati digits accepted) → a number, or undefined when blank or not a number. */
function numberOf(text: string): number | undefined {
  const clean = toAsciiDigits(text).replace(/[,\s]/g, '');
  if (!clean) return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
}

type RangeText = Record<string, { min: string; max: string }>;

/**
 * The Filters screen (F4 + F5 spec §5.7, §8.4, mockup "Filters"): side, condition, fits machine (brand → model → year),
 * distance, state, price, quantity, seller, and the filterable spec fields of the category in play, with page 1's facet
 * counts beside the options. The footer counts the draft live (`POST /discover/search/count`, 300 ms debounce) with the
 * list's frozen origin (R18); Show returns to the list with the new filters.
 */
export default function SearchFiltersScreen({ navigation, route }: RootStackScreenProps<'SearchFilters'>) {
  const { request, origin, originLabel, facets } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const master = useMasterData();

  const start = cleanFilters(request.filters);
  const [draft, setDraft] = useState<SearchFilters>(start);
  const [priceMin, setPriceMin] = useState(start.priceMinPaise !== undefined ? rupeesInput(start.priceMinPaise) : '');
  const [priceMax, setPriceMax] = useState(start.priceMaxPaise !== undefined ? rupeesInput(start.priceMaxPaise) : '');
  const [year, setYear] = useState(start.fit?.year ? String(start.fit.year) : '');
  const [ranges, setRanges] = useState<RangeText>(() => {
    const out: RangeText = {};
    for (const [key, v] of Object.entries(start.specs ?? {})) {
      if (!Array.isArray(v)) out[key] = { min: v.min?.toString() ?? '', max: v.max?.toString() ?? '' };
    }
    return out;
  });
  const [fitLabel, setFitLabel] = useState(route.params.fitLabel);
  const [picker, setPicker] = useState<'brand' | 'model' | null>(null);

  const brands = useBrands('machines');
  const models = useModels(draft.fit?.brandId ?? null);

  // Typed text → the draft's numbers; a value that isn't one is left out and marked.
  const minPaise = priceMin.trim() ? parseRupees(priceMin) : undefined;
  const maxPaise = priceMax.trim() ? parseRupees(priceMax) : undefined;
  const yearValue = numberOf(year);
  const yearBad = !!year.trim() && (yearValue === undefined || !Number.isInteger(yearValue) || yearValue < 1950 || yearValue > 2100);

  const filters = useMemo<SearchFilters>(() => {
    const specs: NonNullable<SearchFilters['specs']> = {};
    for (const [key, v] of Object.entries(draft.specs ?? {})) if (Array.isArray(v)) specs[key] = v;
    for (const [key, r] of Object.entries(ranges)) specs[key] = { min: numberOf(r.min), max: numberOf(r.max) };
    return cleanFilters({
      ...draft,
      priceMinPaise: minPaise ?? undefined,
      priceMaxPaise: maxPaise ?? undefined,
      fit: draft.fit ? { ...draft.fit, year: yearBad ? undefined : yearValue } : undefined,
      specs,
    });
  }, [draft, ranges, minPaise, maxPaise, yearValue, yearBad]);

  const next = withFilters(request, filters);
  const count = useCountOnly(next, origin);
  const footer = footerCopy(count.data);

  const set = (patch: Partial<SearchFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleIn = (list: string[] | undefined, id: string) => {
    const has = list?.includes(id);
    return has ? list!.filter((x) => x !== id) : [...(list ?? []), id];
  };

  const clearAll = () => {
    setDraft(clearAllFilters(draft));
    setPriceMin('');
    setPriceMax('');
    setYear('');
    setRanges({});
    setFitLabel(undefined);
  };

  const apply = () => {
    track(SEARCH_EVENTS.searchFiltersApplied, { count: countFilters(filters) });
    navigation.popTo('SearchResults', { ...next, fitLabel: filters.fit ? fitLabel : undefined });
  };

  const rentals = rentalsOnly(filters);
  const parts = !filters.kinds?.length || filters.kinds.includes('part');
  const withCount = (label: string, n: number | undefined) => (n === undefined ? label : t('discover.search.filters.withCount', { label, count: n }));

  const s = useMemo(() => StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: 120 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    sides: { flexDirection: 'row', gap: spacing.sm },
    side: {
      flex: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.md,
      borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface,
    },
    sideOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    sideLabel: { ...type('caption'), color: colors.textSecondary },
    sideLabelOn: { ...type('caption'), color: colors.primaryInk },
    two: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    gap: { gap: spacing.sm },
  }), [colors, type]);

  const brand = brands.data?.find((b) => b.id === draft.fit?.brandId) ?? null;
  const model = models.data?.find((m) => m.id === draft.fit?.modelId) ?? null;
  const fitName = (b: string | null, m: string | null) => [b, m].filter(Boolean).join(' ') || undefined;

  const specField = (f: SpecFacet) => {
    if (f.type === 'select') {
      const chosen = (draft.specs?.[f.key] as string[] | undefined) ?? [];
      return (
        <Field key={f.key} label={f.label}>
          <View style={s.chips}>
            {f.options.map((o) => (
              <Chip
                key={o.key}
                label={withCount(o.label, o.count)}
                selected={chosen.includes(o.key)}
                onPress={() => set({ specs: { ...draft.specs, [f.key]: toggleIn(chosen, o.key) } })}
                testID="Search-filter-spec-option"
              />
            ))}
          </View>
        </Field>
      );
    }
    const r = ranges[f.key] ?? { min: '', max: '' };
    const setRange = (patch: Partial<{ min: string; max: string }>) => setRanges((x) => ({ ...x, [f.key]: { ...r, ...patch } }));
    const unit = f.unit ? ` ${f.unit}` : '';
    return (
      <View key={f.key} style={s.gap}>
        <Field label={f.label} hint={f.min !== null && f.max !== null ? t('discover.search.filters.specRange', { min: `${f.min}${unit}`, max: `${f.max}${unit}` }) : undefined}>
          <View style={s.two}>
            <View style={s.half}><Input placeholder={t('discover.search.filters.rangeMin')} value={r.min} onChangeText={(v) => setRange({ min: v })} keyboardType="numeric" testID="Search-filter-spec-min" /></View>
            <View style={s.half}><Input placeholder={t('discover.search.filters.rangeMax')} value={r.max} onChangeText={(v) => setRange({ max: v })} keyboardType="numeric" testID="Search-filter-spec-max" /></View>
          </View>
        </Field>
      </View>
    );
  };

  return (
    <ScreenWrapper keyboardAware>
      <Header
        title={t('discover.search.filters.title')}
        rightIcon={<Button title={t('discover.search.filters.clearAll')} variant="ghost" size="sm" phLabel="Search-filters-clear-all" onPress={clearAll} />}
      />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {parts && !rentals ? (
          <Field label={t('discover.search.filters.side')}>
            <View style={s.sides}>
              {SIDES.map((side) => {
                const on = filters.side === side;
                return (
                  <Pressable
                    key={side}
                    style={[s.side, on ? s.sideOn : null]}
                    onPress={() => set({ side: on ? undefined : side })}
                    testID={`Search-filter-side-${side}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <SideToken kind={side} />
                    <Text style={on ? s.sideLabelOn : s.sideLabel}>
                      {withCount(t(`discover.chips.side.${side}`), facets?.side[side])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        ) : null}

        {!rentals && master.data ? (
          <Field label={t('discover.search.filters.condition')}>
            <View style={s.chips}>
              {master.data.conditions.filter((c) => c.isActive).map((c) => (
                <Chip
                  key={c.id}
                  label={withCount(c.label, facets ? (facets.conditions.find((x) => x.id === c.id)?.count ?? 0) : undefined)}
                  selected={!!filters.conditionIds?.includes(c.id)}
                  onPress={() => set({ conditionIds: toggleIn(draft.conditionIds, c.id) })}
                  testID="Search-filter-condition"
                />
              ))}
            </View>
          </Field>
        ) : null}

        {!rentals ? (
          <View style={s.gap}>
            <PickerField
              label={t('discover.search.filters.fit')}
              value={brand?.name ?? (draft.fit ? fitLabel ?? null : null)}
              placeholder={t('discover.search.filters.fitBrandPick')}
              onPress={() => setPicker('brand')}
              testID="Search-filter-fit-brand"
            />
            {draft.fit ? (
              <>
                <PickerField
                  label={t('discover.search.filters.fitModel')}
                  value={model?.name ?? (draft.fit.modelId ? fitLabel ?? null : t('discover.search.filters.anyModel'))}
                  placeholder={t('discover.search.filters.anyModel')}
                  onPress={() => setPicker('model')}
                  testID="Search-filter-fit-model"
                />
                <Input
                  label={t('discover.search.filters.fitYear')}
                  placeholder={t('discover.search.filters.fitYearPlaceholder')}
                  value={year}
                  onChangeText={setYear}
                  keyboardType="number-pad"
                  maxLength={4}
                  error={yearBad ? t('discover.search.filters.fitYearInvalid') : undefined}
                  testID="Search-filter-fit-year"
                />
                <Button
                  title={t('discover.search.filters.fitClear')}
                  variant="ghost"
                  size="sm"
                  phLabel="Search-filter-fit-clear"
                  onPress={() => {
                    set({ fit: undefined });
                    setYear('');
                    setFitLabel(undefined);
                  }}
                />
              </>
            ) : null}
          </View>
        ) : null}

        {origin ? (
          <Field
            label={t('discover.search.filters.distance')}
            hint={originLabel ? t('discover.search.filters.distanceFrom', { label: originLabel }) : undefined}
          >
            <View style={s.chips}>
              {RADII.map((r) => {
                const copy = r === null ? { key: 'discover.radius.allIndia' } : { key: 'discover.radius.km', params: { km: r } };
                return (
                  <Chip
                    key={r ?? 'all'}
                    label={t(copy.key, copy.params)}
                    role="radio"
                    selected={filters.radiusKm === r}
                    onPress={() => set({ radiusKm: r })}
                    testID="Search-filter-radius"
                  />
                );
              })}
            </View>
          </Field>
        ) : null}

        {(facets?.states.length ?? 0) > 0 || filters.states?.length ? (
          <Field label={t('discover.search.filters.place')}>
            <View style={s.chips}>
              {[
                ...(facets?.states ?? []),
                ...(filters.states ?? []).filter((st) => !facets?.states.some((x) => x.state === st)).map((st) => ({ state: st, count: undefined })),
              ].map((x) => (
                <Chip
                  key={x.state}
                  label={withCount(x.state, x.count)}
                  selected={!!filters.states?.includes(x.state)}
                  onPress={() => set({ states: toggleIn(draft.states, x.state) })}
                  testID="Search-filter-state"
                />
              ))}
            </View>
          </Field>
        ) : null}

        <View style={s.gap}>
          <Field label={rentals ? t('discover.search.filters.priceDay') : t('discover.search.filters.price')}>
            <View style={s.two}>
              <View style={s.half}>
                <Input
                  placeholder={t('discover.search.filters.min')}
                  value={priceMin}
                  onChangeText={setPriceMin}
                  keyboardType="numeric"
                  error={minPaise === null ? t('discover.search.filters.priceInvalid') : undefined}
                  testID="Search-filter-price-min"
                />
              </View>
              <View style={s.half}>
                <Input
                  placeholder={t('discover.search.filters.max')}
                  value={priceMax}
                  onChangeText={setPriceMax}
                  keyboardType="numeric"
                  error={maxPaise === null ? t('discover.search.filters.priceInvalid') : undefined}
                  testID="Search-filter-price-max"
                />
              </View>
            </View>
          </Field>
          <View style={s.chips}>
            <Chip
              label={t('discover.search.filters.hideOnRequest')}
              selected={!!filters.hidePriceOnRequest}
              onPress={() => set({ hidePriceOnRequest: !draft.hidePriceOnRequest })}
              testID="Search-filter-hide-on-request"
            />
          </View>
        </View>

        {!rentals ? (
          <Field label={t('discover.search.filters.quantity')}>
            <View style={s.chips}>
              <Chip label={t('discover.search.filters.any')} role="radio" selected={!filters.minQty} onPress={() => set({ minQty: undefined })} testID="Search-filter-qty-any" />
              {MIN_QTY_STEPS.map((q) => (
                <Chip
                  key={q}
                  label={t('discover.search.filters.qtyStep', { qty: q })}
                  role="radio"
                  selected={filters.minQty === q}
                  onPress={() => set({ minQty: q })}
                  testID="Search-filter-qty"
                />
              ))}
            </View>
          </Field>
        ) : null}

        <Field label={t('discover.search.filters.seller')}>
          <View style={s.chips}>
            <Chip
              label={withCount(t('discover.search.filters.gstVerified'), facets?.gstVerified)}
              selected={!!filters.gstVerifiedOnly}
              onPress={() => set({ gstVerifiedOnly: !draft.gstVerifiedOnly })}
              testID="Search-filter-gst"
            />
            <Chip
              label={withCount(t('discover.search.filters.delivers'), facets?.delivers)}
              selected={!!filters.delivers}
              onPress={() => set({ delivers: !draft.delivers })}
              testID="Search-filter-delivers"
            />
            {videoUploadEnabled() ? (
              <Chip
                label={t('discover.search.filters.hasVideo')}
                selected={!!filters.hasVideo}
                onPress={() => set({ hasVideo: !draft.hasVideo })}
                testID="Search-filter-video"
              />
            ) : null}
          </View>
        </Field>

        {(facets?.specs ?? []).map(specField)}

      </ScrollView>

      <FooterBar>
        <Button
          title={t(footer.key, footer.params)}
          size="md"
          disabled={footer.disabled || yearBad || minPaise === null || maxPaise === null}
          loading={count.isFetching && !count.data}
          phLabel="Search-filters-show"
          onPress={apply}
        />
      </FooterBar>

      <PickerSheet
        visible={picker === 'brand'}
        title={t('discover.search.filters.fitBrand')}
        options={(brands.data ?? []).map((b) => ({ id: b.id, label: b.name }))}
        selectedId={draft.fit?.brandId ?? null}
        onPick={(id) => {
          const b = brands.data?.find((x) => x.id === id);
          set({ fit: { brandId: id } });
          setFitLabel(fitName(b?.name ?? null, null));
        }}
        onClose={() => setPicker(null)}
        testID="Search-filter-brand-sheet"
      />
      <PickerSheet
        visible={picker === 'model'}
        title={t('discover.search.filters.fitModel')}
        options={(models.data ?? []).filter((m) => m.isActive).map((m) => ({ id: m.id, label: m.name }))}
        extra={[{ id: '', label: t('discover.search.filters.anyModel') }]}
        selectedId={draft.fit?.modelId ?? ''}
        onPick={(id) => {
          if (!draft.fit) return;
          const m = models.data?.find((x) => x.id === id);
          set({ fit: { brandId: draft.fit.brandId, ...(id ? { modelId: id } : {}) } });
          setFitLabel(fitName(brand?.name ?? null, m?.name ?? null));
        }}
        onClose={() => setPicker(null)}
        testID="Search-filter-model-sheet"
      />
    </ScreenWrapper>
  );
}
