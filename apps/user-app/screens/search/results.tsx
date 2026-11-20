import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DiscoveryOrigin, DiscoveryRadiusKm, ListingCard, SearchPage, SearchSort } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FilterChipRow, { type FilterChipItem } from '@/components/FilterChipRow';
import GridCard from '@/components/GridCard';
import IconButton from '@/components/IconButton';
import ListRow from '@/components/ListRow';
import LocationSheet from '@/components/LocationSheet';
import Notice from '@/components/Notice';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import RequestPrefillCard from '@/components/part-requests/RequestPrefillCard';
import { useSearch } from '@/hooks/use-discover';
import { originStore, useDiscoveryOrigin } from '@/hooks/use-discovery-origin';
import { useBrands, useMasterData } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { SEARCH_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { isSearchRedirect } from '@/lib/discover-api';
import { ChevronLeft, MapPin, Package, Search, SlidersHorizontal, TriangleAlert } from '@/lib/icons';
import { LISTING_ERROR_KEYS } from '@/lib/listing-errors';
import { prefillFromReading } from '@/lib/part-request-form';
import { recordRecentSearch } from '@/lib/recent-searches';
import { countFilters, filterChipSummaries, radiusLabel } from '@/lib/search-filters';
import {
  bannerCopy, clearFilter, countLine, noResultsCopy, normaliseRequest, readingChips, removeReadingChip, rentalsOnly,
  sortOptions, submittedProps, withFilters, withQuery, withRadius, withSort, type ClearableFilter, type ResultsRequest,
} from '@/lib/search-request';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from '@/screens/listing/listing-card-item';
import SearchBar from './search-bar';
import SortSheet from './sort-sheet';

interface Frozen {
  origin: DiscoveryOrigin;
  /** The location sheet's radius when the list opened (the list's own `radiusKm` filter wins when set). */
  radiusKm: DiscoveryRadiusKm | null;
}

/** The origin a list is opened with (R18): read once, then sent with every page and count of that list. */
const captureOrigin = (freeze: () => DiscoveryOrigin): Frozen => ({ origin: freeze(), radiusKm: originStore.getSnapshot().radiusKm });

/** Codes a retry can't fix: the screen offers to reset the search instead. */
const RESET_CODES = new Set(['LOCATION_REQUIRED', 'SORT_NEEDS_MACHINES', 'FILTER_NOT_AVAILABLE']);

/**
 * Search results (F4 + F5 spec §8.4, mockups "Search results", "No results", "Machines for rent"): the search bar, the
 * filter row (Filters n, the reader's removable chips, the radius chip, quick chips), the count line with Sort, the
 * "Listing #…" row, cards (a grid for rentals only), infinite scroll, the partial banner with Widen, No results.
 * The route params are the request; the origin is frozen per list (R18) once the stored location is read.
 */
export default function SearchResultsScreen({ navigation, route }: RootStackScreenProps<'SearchResults'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const origin = useDiscoveryOrigin();
  const master = useMasterData();

  const { fitLabel, ...params } = route.params ?? {};
  const paramsJson = JSON.stringify(params);
  const request = useMemo(() => normaliseRequest(params), [paramsJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const [frozen, setFrozen] = useState<Frozen | null>(() => (origin.ready ? captureOrigin(origin.freeze) : null));
  useEffect(() => {
    if (!frozen && origin.ready) setFrozen(captureOrigin(origin.freeze));
  }, [origin.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasOrigin = !!frozen?.origin;

  // The distance: the list's own filter (Filters, Widen), else the location sheet's radius when the list opened.
  const effective = useMemo<ResultsRequest>(() => {
    if (!frozen || request.filters?.radiusKm !== undefined) return request;
    return normaliseRequest({ ...request, filters: { ...request.filters, radiusKm: frozen.radiusKm } });
  }, [request, frozen]);
  const radiusKm = effective.filters?.radiusKm ?? null;

  const search = useSearch(effective, frozen?.origin ?? null, !!frozen);
  const pages = search.data?.pages ?? [];
  const first = pages[0];
  const page: SearchPage | null = first && !isSearchRedirect(first) ? first : null;
  const items = useMemo(
    () => pages.flatMap((p) => (isSearchRedirect(p) ? [] : p.items)),
    [pages],
  );
  // The chips and counts of the last page 1, so the filter row doesn't blink while a changed list loads.
  const lastPage = useRef<SearchPage | null>(null);
  if (page) lastPage.current = page;
  const shown = page ?? lastPage.current;

  const [text, setText] = useState(request.q ?? '');
  useEffect(() => setText(request.q ?? ''), [request.q]);
  const [sortOpen, setSortOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);

  // `#ref` of a public listing: open it in place of the results.
  useEffect(() => {
    if (first && isSearchRedirect(first)) navigation.replace('Listing', { listingId: first.redirect.listingId });
  }, [first]); // eslint-disable-line react-hooks/exhaustive-deps

  // Page 1 of a new list: hand the origin echo over (out_of_range → fallback next time) and report the search.
  const listKey = JSON.stringify([effective, frozen?.origin ?? null]);
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!page || reported.current === listKey) return;
    reported.current = listKey;
    origin.reportEcho(page.origin);
    track(SEARCH_EVENTS.searchSubmitted, submittedProps(page.reading, effective.filters));
    if (page.items.length === 0 && !page.partial) {
      track(SEARCH_EVENTS.searchZeroResults, { kinds: submittedProps(page.reading, effective.filters).kinds });
    }
  }, [page, listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next: ResultsRequest, label: string | undefined = fitLabel) => {
    navigation.setParams({
      q: next.q, filters: next.filters, removedChips: next.removedChips, sort: next.sort,
      fitLabel: next.filters?.fit ? label : undefined,
    });
  };

  const submit = () => {
    const q = text.trim();
    if (q === (request.q ?? '')) return;
    if (q) void recordRecentSearch(q);
    // A new search is a new list: it takes the origin as it is now (R18).
    setFrozen(captureOrigin(origin.freeze));
    update(withQuery(request, q));
  };

  const openFilters = () => {
    if (!frozen) return;
    navigation.navigate('SearchFilters', {
      request: effective,
      origin: frozen.origin,
      originLabel: shown?.origin.label ?? null,
      facets: shown?.facets ?? null,
      fitLabel,
    });
  };

  // The sheet's origin and radius when it opened: closing it unchanged keeps the list (and a Widen / Filters distance).
  const beforeSheet = useRef<Frozen | null>(null);
  const openLocation = () => {
    beforeSheet.current = captureOrigin(origin.freeze);
    setLocationOpen(true);
  };
  const closeLocation = () => {
    setLocationOpen(false);
    // A location changed in the sheet starts a new list with the new origin and radius (R18).
    const next = captureOrigin(origin.freeze);
    const before = beforeSheet.current;
    beforeSheet.current = null;
    if (!frozen || !before) return;
    if (JSON.stringify(next.origin) === JSON.stringify(before.origin) && next.radiusKm === before.radiusKm) return;
    setFrozen(next);
    update(withRadius(request, next.radiusKm));
  };

  const widen = (to: DiscoveryRadiusKm | null) => {
    track(SEARCH_EVENTS.searchWidened, { radiusKm: to });
    update(withRadius(request, to));
  };

  const openListing = (card: ListingCard, index: number) => {
    track(SEARCH_EVENTS.searchResultOpened, { position: index + 1 });
    navigation.navigate('Listing', { listingId: card.id });
  };

  // ─── The filter row ───
  const filters = request.filters ?? {};
  const chips: FilterChipItem[] = [];
  const n = countFilters(filters);
  chips.push({
    id: 'filters',
    label: n > 0 ? t('discover.search.results.filtersCount', { count: n }) : t('discover.search.results.filters'),
    icon: SlidersHorizontal,
    selected: n > 0,
    onPress: openFilters,
    testID: 'Search-results-filters',
  });
  if (filters.kinds?.length) {
    chips.push({
      id: 'kinds',
      label: filters.kinds.length === 1 ? t(`listing.kind.${filters.kinds[0]}`) : t('discover.search.results.kinds', { count: filters.kinds.length }),
      selected: true,
      onRemove: () => update(clearFilter(request, 'kinds')),
      testID: 'Search-chip-kinds',
    });
  }
  for (const c of readingChips(shown?.reading)) {
    chips.push({
      id: `reading-${c.id}`,
      label: c.text ?? t(c.copy!.key, c.copy!.params),
      selected: true,
      onRemove: () => update(removeReadingChip(request, c.id)),
      testID: `Search-chip-${c.id}`,
    });
  }
  if (filters.fit) {
    chips.push({
      id: 'fit',
      label: fitLabel ?? t('discover.chips.fit'),
      selected: true,
      onPress: openFilters,
      onRemove: () => update(clearFilter(request, 'fit'), undefined),
      testID: 'Search-chip-fit',
    });
  }
  const radiusCopy = hasOrigin ? radiusLabel(radiusKm) : { key: 'discover.radius.allIndia' };
  chips.push({
    id: 'radius',
    label: t(radiusCopy.key, radiusCopy.params),
    icon: MapPin,
    selected: true,
    onPress: openLocation,
    testID: 'Search-chip-radius',
  });
  for (const c of filterChipSummaries(filters)) {
    if (c.id === 'side' || c.id === 'radius' || c.id === 'fit') continue;
    const id = c.id as ClearableFilter;
    chips.push({
      id: c.id,
      label: t(c.key, c.params),
      selected: true,
      onPress: openFilters,
      onRemove: () => update(clearFilter(request, id)),
      testID: `Search-chip-${c.id}`,
    });
  }
  if (!rentalsOnly(filters) && !filters.conditionIds?.length) {
    for (const key of ['used', 'new']) {
      const cond = master.data?.conditions.find((x) => x.key === key && x.isActive);
      if (!cond) continue;
      chips.push({
        id: `quick-${key}`,
        label: cond.label,
        onPress: () => update(withFilters(request, { ...filters, conditionIds: [cond.id] })),
        testID: `Search-quick-${key}`,
      });
    }
  }
  if (filters.priceMinPaise === undefined && filters.priceMaxPaise === undefined && !filters.hidePriceOnRequest) {
    chips.push({ id: 'quick-price', label: t('discover.search.results.price'), onPress: openFilters, testID: 'Search-quick-price' });
  }

  const sort: SearchSort = page?.sort ?? request.sort ?? 'best_match';
  const grid = rentalsOnly(filters);

  const s = useMemo(() => StyleSheet.create({
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    bar: { flex: 1 },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
    gridRow: { gap: spacing.md },
    gridCell: { flex: 1 },
    countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
    count: { ...type('label'), color: colors.textMuted, flex: 1 },
    head: { gap: spacing.md, paddingBottom: spacing.xs },
    skeleton: { height: 112, borderRadius: radius.lg },
    footer: { paddingVertical: spacing.lg },
  }), [colors, type]);

  const banner = page ? bannerCopy(page, radiusKm, hasOrigin) : [];
  const header = page ? (
    <View style={s.head}>
      {banner.length > 0 ? (
        <Notice tone="info" title={t('discover.search.results.closeMatches')} text={banner.map((c) => t(c.key, c.params)).join(' ')}>
          {page.widen ? (
            <Button
              title={t('discover.search.results.widen')}
              variant="outline"
              size="sm"
              phLabel="Search-partial-widen"
              onPress={() => widen(page.widen!.radiusKm)}
            />
          ) : null}
        </Notice>
      ) : page.total !== null && items.length > 0 ? (
        <View style={s.countRow}>
          <Text style={s.count}>
            {(() => {
              const c = countLine(page.total, sort);
              return t(c.key, { ...c.params, order: t(c.orderKey) });
            })()}
          </Text>
          <Button title={t('discover.search.results.sort')} variant="ghost" size="sm" phLabel="Search-sort" onPress={() => setSortOpen(true)} />
        </View>
      ) : null}
      {page.refSuggestion ? (
        <Card flush>
          <ListRow
            icon={Package}
            label={t('discover.search.results.refRow', { ref: page.refSuggestion.ref })}
            hint={t('discover.search.results.refHint')}
            chevron
            last
            onPress={() => navigation.navigate('Listing', { listingId: page.refSuggestion!.listingId })}
            testID="Search-ref-row"
          />
        </Card>
      ) : null}
    </View>
  ) : null;

  // F8: a brand chip becomes the prefill's fit only for a brand that makes machines (a parts brand is not a machine).
  const machineBrands = useBrands('machines');
  const machineBrandIds = useMemo(() => (machineBrands.data ? new Set(machineBrands.data.map((b) => b.id)) : null), [machineBrands.data]);

  let empty: React.ReactElement | null = null;
  const code = search.isError ? errorCode(search.error) : null;
  if (!frozen || search.isLoading || code === 'CURSOR_INVALID' || (first && isSearchRedirect(first))) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (search.isError) {
    const reset = code !== null && RESET_CODES.has(code);
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('discover.search.results.loadError')}
        subtitle={t(errorKey(search.error, LISTING_ERROR_KEYS, 'discover.search.results.loadErrorBody'))}
        ctaTitle={reset ? t('discover.search.results.reset') : t('common.retry')}
        ctaPhLabel={reset ? 'Search-results-reset' : 'Search-results-retry'}
        onCtaPress={() => (reset
          ? update(normaliseRequest({ q: request.q, filters: { kinds: filters.kinds, radiusKm: filters.radiusKm } }), undefined)
          : void search.refetch())}
      />
    );
  } else if (page) {
    const none = noResultsCopy(page, radiusKm, hasOrigin);
    empty = (
      <View style={{ gap: spacing.lg }}>
        <EmptyState
          icon={Search}
          title={t(none.title.key, none.title.params)}
          subtitle={t('discover.search.noResults.body')}
          ctaTitle={none.widen ? t(none.widen.key, none.widen.params) : undefined}
          ctaPhLabel="Search-no-results-widen"
          onCtaPress={none.widen ? () => widen(page.widen!.radiusKm) : undefined}
        />
        {/* F8 R15: a part or machine nobody lists yet can be asked for (not for rentals, which F8 doesn't cover). */}
        {!rentalsOnly(filters) ? <RequestPrefillCard prefill={prefillFromReading(page.reading, request.q ?? '', machineBrandIds)} /> : null}
      </View>
    );
  }

  const listFooter = search.isFetchingNextPage
    ? <View style={s.footer}><ActivityIndicator color={colors.primary} /></View>
    : null;

  return (
    <ScreenWrapper>
      <View style={s.top}>
        <IconButton icon={ChevronLeft} iconSize={22} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} testID="Back-button" />
        <SearchBar value={text} onChangeText={setText} onSubmit={submit} testID="Search-results-input" style={s.bar} />
      </View>
      <FilterChipRow items={chips} />
      <FlatList<ListingCard>
        key={grid ? 'grid' : 'list'}
        data={items}
        keyExtractor={(c) => c.id}
        numColumns={grid ? 2 : 1}
        columnWrapperStyle={grid ? s.gridRow : undefined}
        renderItem={({ item, index }) => (grid ? (
          <GridCard card={item} onPress={() => openListing(item, index)} testID={`Search-result-${item.ref}`} style={s.gridCell} />
        ) : (
          <ListingCardItem card={item} onPress={() => openListing(item, index)} testID={`Search-result-${item.ref}`} />
        ))}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={listFooter}
        contentContainerStyle={s.list}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        refreshing={search.isRefetching && !search.isFetchingNextPage}
        onRefresh={() => void search.refetch()}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
      <SortSheet
        visible={sortOpen}
        options={sortOptions({ kinds: filters.kinds, hasOrigin })}
        value={sort}
        onPick={(next) => update(withSort(request, next))}
        onClose={() => setSortOpen(false)}
      />
      <LocationSheet visible={locationOpen} onClose={closeLocation} />
    </ScreenWrapper>
  );
}
