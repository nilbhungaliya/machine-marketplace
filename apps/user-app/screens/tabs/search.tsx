import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, type TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { BrowseView, Suggestion } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import ListRow from '@/components/ListRow';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { useBrowse, useSuggest, useTrending } from '@/hooks/use-discover';
import { useDiscoveryOrigin } from '@/hooks/use-discovery-origin';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { SEARCH_EVENTS } from '@/lib/analytics-events';
import { ChevronRight, Clock, Inbox, MapPin, Package, Search, TriangleAlert } from '@/lib/icons';
import { clearRecentSearches, loadRecentSearches, recordRecentSearch } from '@/lib/recent-searches';
import { browseBackTarget, browseCrumbs, browseRowOpens, startState, suggestionRow, suggestionTarget } from '@/lib/search-start';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';
import CountPill from '@/screens/search/count-pill';
import SearchBar from '@/screens/search/search-bar';

/**
 * The Search tab (F4 + F5 spec §8.4, mockup "Browse by machine"): the search bar; while typing, suggestions (category
 * with its path, brand, model, "Listing #…") under "Search for '…'"; otherwise recent searches, popular searches and
 * Browse (crumbs, rows with live counts, "Popular brands here" → the brand view). Params: `browseNodeId` opens Browse
 * at that node (Home's category tiles), `focus` focuses the bar (Home's search bar).
 */
export default function SearchScreen({ navigation, route }: TabScreenProps<'Search'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const tabInset = useTabBarInset();
  const origin = useDiscoveryOrigin();
  const inputRef = useRef<TextInput>(null);

  const initial = startState(route.params);
  const [query, setQuery] = useState('');
  const [nodeId, setNodeId] = useState<string | null>(initial.browseNodeId);
  const [allIndia, setAllIndia] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  // Home opens the tab at a node or focused: apply the params, then clear them so the same tile works twice.
  useEffect(() => {
    const start = startState(route.params);
    if (!route.params) return;
    if (start.browseNodeId) {
      setNodeId(start.browseNodeId);
      setQuery('');
    }
    if (start.focus) setTimeout(() => inputRef.current?.focus(), 50);
    navigation.setParams({ browseNodeId: undefined, focus: undefined });
  }, [route.params?.browseNodeId, route.params?.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setAllIndia(false), [nodeId]);

  useFocusEffect(useCallback(() => {
    void loadRecentSearches().then(setRecent);
  }, []));

  const browse = useBrowse(
    { parentId: nodeId, origin: origin.origin, radiusKm: allIndia ? null : origin.radiusKm },
    origin.ready,
  );
  const trending = useTrending();
  const typing = query.trim().length > 0;
  const suggest = useSuggest(query);
  const view = browse.data;

  // Android Back walks up the tree before leaving the tab. It reads the last loaded view, so Back while a node is
  // still loading goes to that node's parent (not the root); the tree shows its skeleton meanwhile.
  const crumbs = browseCrumbs(view);
  const lastView = useRef<BrowseView | null>(null);
  if (view) lastView.current = view;
  useFocusEffect(useCallback(() => {
    if (!nodeId || typing) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setNodeId(browseBackTarget(nodeId, lastView.current));
      return true;
    });
    return () => sub.remove();
  }, [nodeId, typing]));

  const submit = (text = query) => {
    const q = text.trim();
    if (!q) return;
    void recordRecentSearch(q).then(setRecent);
    navigation.navigate('SearchResults', { q });
  };

  const openSuggestion = (sug: Suggestion) => {
    const target = suggestionTarget(sug);
    if (target.screen === 'Listing') navigation.navigate('Listing', { listingId: target.listingId });
    else navigation.navigate('SearchResults', target.request);
  };

  // "Show all India" (the near-empty state) carries into what Browse opens: results and the brand view search all India.
  const allIndiaRadius = allIndia ? { radiusKm: null } : {};

  const openChild = (child: BrowseView['children'][number]) => {
    track(SEARCH_EVENTS.browseNodeOpened, { level: child.level });
    if (browseRowOpens(child) === 'results') navigation.navigate('SearchResults', { filters: { categoryId: child.id, ...allIndiaRadius } });
    else setNodeId(child.id);
  };

  const s = useMemo(() => StyleSheet.create({
    content: { paddingTop: spacing.md, paddingBottom: tabInset + spacing.lg, gap: spacing.md },
    bar: { marginHorizontal: spacing.lg },
    section: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
    title: { ...type('section'), color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    crumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    crumb: { ...type('label'), color: colors.textMuted, paddingVertical: spacing.sm },
    crumbCurrent: { ...type('label'), color: colors.text, paddingVertical: spacing.sm },
    skeleton: { height: 56, borderRadius: radius.md },
    trailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  }), [colors, type, tabInset]);

  const countTrailing = (n: number) => (
    <View style={s.trailing}>
      <CountPill count={n} />
      <ChevronRight size={18} color={colors.textMuted} />
    </View>
  );

  const suggestions = (
    <View style={s.section}>
      <Card flush>
        <ListRow
          icon={Search}
          label={t('discover.search.suggest.searchFor', { q: query.trim() })}
          onPress={() => submit()}
          last={!suggest.data?.length}
          testID="Search-submit-row"
        />
        {(suggest.data ?? []).map((sug, i, all) => {
          const row = suggestionRow(sug);
          const kind = t(row.typeKey, row.ref !== null ? { ref: row.ref } : undefined);
          return (
            <ListRow
              key={`${sug.type}-${sug.id}`}
              icon={sug.type === 'listing' ? Package : undefined}
              label={row.title}
              hint={row.subtitle ? `${kind} · ${row.subtitle}` : kind}
              trailing={sug.type === 'listing' ? undefined : <CountPill count={row.count} />}
              chevron={sug.type === 'listing'}
              onPress={() => openSuggestion(sug)}
              last={i === all.length - 1}
              testID={`Search-suggestion-${sug.type}`}
            />
          );
        })}
      </Card>
    </View>
  );

  const recentBlock = recent.length > 0 && !nodeId ? (
    <View style={s.section}>
      <View style={s.head}>
        <Text style={s.title}>{t('discover.search.start.recent')}</Text>
        <Button
          title={t('discover.search.start.clearRecent')}
          variant="ghost"
          size="sm"
          phLabel="Search-recent-clear"
          onPress={() => {
            setRecent([]);
            void clearRecentSearches();
          }}
        />
      </View>
      <Card flush>
        {recent.map((q, i) => (
          <ListRow key={q} icon={Clock} label={q} onPress={() => submit(q)} last={i === recent.length - 1} testID="Search-recent-row" />
        ))}
      </Card>
    </View>
  ) : null;

  const trendingBlock = (trending.data?.length ?? 0) > 0 && !nodeId ? (
    <View style={s.section}>
      <Text style={s.title}>{t('discover.search.start.trending')}</Text>
      <View style={s.chips}>
        {trending.data!.map((q) => (
          <Chip key={q} label={q} role="button" onPress={() => submit(q)} testID="Search-trending-chip" />
        ))}
      </View>
    </View>
  ) : null;

  let tree: React.ReactNode;
  if (!origin.ready || browse.isLoading) {
    tree = <View style={{ gap: spacing.sm }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (browse.isError || !view) {
    tree = (
      <EmptyState
        icon={TriangleAlert}
        title={t('discover.search.browse.loadError')}
        subtitle={t('discover.search.browse.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Search-browse-retry"
        onCtaPress={() => void browse.refetch()}
      />
    );
  } else {
    const nearOnly = view.children.length === 0 && view.radiusKm !== null && origin.origin !== null;
    tree = (
      <>
        {view.node ? (
          <Card flush>
            <ListRow
              label={t('discover.search.browse.seeAll', { name: view.node.name })}
              chevron
              last
              onPress={() => navigation.navigate('SearchResults', { filters: { categoryId: view.node!.id, ...allIndiaRadius } })}
              testID="Search-browse-see-all"
            />
          </Card>
        ) : null}
        {view.children.length > 0 ? (
          <Card flush>
            {view.children.map((child, i) => (
              <ListRow
                key={child.id}
                label={child.name}
                trailing={countTrailing(child.liveCount)}
                onPress={() => openChild(child)}
                last={i === view.children.length - 1}
                testID="Search-browse-row"
                accessibilityRole="button"
              />
            ))}
          </Card>
        ) : nearOnly ? (
          <EmptyState
            icon={MapPin}
            title={t('discover.search.browse.emptyNear', { km: view.radiusKm })}
            subtitle={t('discover.search.browse.emptyNearBody')}
            ctaTitle={t('discover.search.browse.showAllIndia')}
            ctaPhLabel="Search-browse-all-india"
            onCtaPress={() => setAllIndia(true)}
          />
        ) : (
          <EmptyState icon={Inbox} title={t('discover.search.browse.empty')} subtitle={t('discover.search.browse.emptyBody')} />
        )}
        {view.popularBrands.length > 0 ? (
          <>
            <Text style={s.title}>{t('discover.search.browse.popularBrands')}</Text>
            <View style={s.chips}>
              {view.popularBrands.map((b) => (
                <Chip
                  key={b.id}
                  label={b.name}
                  role="button"
                  onPress={() => navigation.navigate('SearchBrand', { brandId: b.id, brandName: b.name, ...allIndiaRadius })}
                  testID="Search-popular-brand"
                />
              ))}
            </View>
          </>
        ) : null}
      </>
    );
  }

  const browseBlock = (
    <View style={s.section}>
      <Text style={s.title}>{t('discover.search.start.browse')}</Text>
      {crumbs.length > 1 ? (
        <View style={s.crumbs}>
          {crumbs.map((c, i) => (
            <React.Fragment key={c.id ?? 'root'}>
              {i > 0 ? <ChevronRight size={14} color={colors.textMuted} /> : null}
              {c.current ? (
                <Text style={s.crumbCurrent}>{c.name ?? t('discover.search.browse.root')}</Text>
              ) : (
                <Pressable onPress={() => setNodeId(c.id)} testID="Search-crumb" accessibilityRole="button" hitSlop={6}>
                  <Text style={s.crumb}>{c.name ?? t('discover.search.browse.root')}</Text>
                </Pressable>
              )}
            </React.Fragment>
          ))}
        </View>
      ) : null}
      {tree}
    </View>
  );

  return (
    <ScreenWrapper edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <SearchBar
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onSubmit={() => submit()}
          testID="Search-input"
          style={s.bar}
        />
        {typing ? suggestions : (
          <>
            {recentBlock}
            {trendingBlock}
            {browseBlock}
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}
