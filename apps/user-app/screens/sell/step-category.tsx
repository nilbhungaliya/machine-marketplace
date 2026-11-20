import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryNode } from '@mpm/shared-types';
import { CATEGORY_EDITABLE_STATUSES } from '@mpm/shared-types';
import Card from '@/components/Card';
import Field, { FieldError } from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import Notice from '@/components/Notice';
import { useDeleteDraft } from '@/hooks/use-sell-draft';
import { useType } from '@/hooks/use-type';
import { ChevronLeft, ClipboardList, Clock, Info, Search } from '@/lib/icons';
import { fetchPartRequest } from '@/lib/part-requests-api';
import { qk } from '@/lib/query-keys';
import {
  categoryLevelFor, findNode, nodePath, pushRecent, recentNodes, requestScopeTypeId, scopedPartGroups, searchCategories,
} from '@/lib/sell-category';
import { spacing, useTheme } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';

const recentKey = (level: string) => `sell.recentCategories.${level}`;

async function readRecent(level: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(recentKey(level));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeRecent(level: string, ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(recentKey(level), JSON.stringify(ids));
  } catch {
    // A preference only: the next pick tries again.
  }
}

/**
 * Step 1, Category (F2 spec §5.2, R28): a search over the cached tree with breadcrumbs, the device's last 5 picks, and
 * a drill-down (machine category → machine type → part group). Parts pick a part group, machines a machine type. The
 * category can change only in `draft` and `rejected` (R43); the server then drops specs, side and fit that don't fit.
 * Leaving a draft that still has no category deletes it, so abandoned starts don't count toward the draft limit.
 *
 * F8 (spec §9.3): a draft made to answer a part request (`partRequestId`) on a machine type has no category; the step
 * loads the request and scopes the picker to that machine type's part groups (drill-down, search and recent picks),
 * so the listing stays inside what the buyer asked for. A part-group or machine request's draft arrives with its
 * category set. If the request can't be loaded (closed, gone), the picker isn't scoped.
 */
export default function StepCategory({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { listing, tree } = ctx;
  const level = categoryLevelFor(listing.kind);
  const locked = !(CATEGORY_EDITABLE_STATUSES as readonly string[]).includes(listing.status);

  const [picked, setPicked] = useState<string | null>(listing.categoryId);
  // Drill-down position: the node whose children are listed (null = the machine categories).
  const [openId, setOpenId] = useState<string | null>(() => findNode(tree, listing.categoryId)?.parentId ?? null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  // Compared with the category at mount, not the live owner view, so a saved step stays clean.
  const [initial] = useState(listing.categoryId);

  // F8 §9.3: the request this draft answers, for its machine type (cached under the request's own key).
  const requestId = listing.kind === 'part' ? listing.partRequestId : null;
  const request = useQuery({
    queryKey: qk.partRequest(requestId ?? ''),
    queryFn: () => fetchPartRequest(requestId!),
    enabled: !!requestId,
    retry: false,
    staleTime: 60_000,
  });
  const scopeId = requestScopeTypeId(tree, request.data);
  const scope = findNode(tree, scopeId);
  const scopeIds = useMemo(() => new Set(scopedPartGroups(tree, scopeId).map((n) => n.id)), [tree, scopeId]);
  // The request can load after the seller started browsing: when the scope first resolves, bring the drill-down back
  // into it (its children are part groups, so the only open node inside the scope is the machine type itself).
  const scopeApplied = useRef(false);
  useEffect(() => {
    if (!scopeId || scopeApplied.current) return;
    scopeApplied.current = true;
    setOpenId((cur) => (cur !== null && cur !== scopeId ? null : cur));
  }, [scopeId]);

  useEffect(() => { void readRecent(level).then(setRecent); }, [level]);

  // Back from step 1 with nothing picked: the draft is empty (every other step comes after this one), so delete it
  // rather than leave it in Drafts and toward `DRAFT_LIMIT`. With a pick, the frame's autosave keeps it instead.
  const navigation = useNavigation();
  const deleteDraft = useDeleteDraft();
  const qc = useQueryClient();
  const empty = useRef(false);
  empty.current = ctx.mode === 'create' && listing.status === 'draft' && !listing.categoryId && !picked;
  // F8 §9.3: deleting a reply draft deletes its pending reply too; refresh the request so no "Pending" reply stays.
  // The promise (not `mutate`'s callbacks) because the screen is unmounting.
  const answersRequest = useRef(listing.partRequestId);
  answersRequest.current = listing.partRequestId;
  useEffect(() => navigation.addListener('beforeRemove', () => {
    if (!empty.current) return;
    const partRequestId = answersRequest.current;
    void deleteDraft.mutateAsync(listing.id).then(() => {
      if (!partRequestId) return;
      void qc.invalidateQueries({ queryKey: qk.partRequest(partRequestId) });
      void qc.invalidateQueries({ queryKey: qk.allPartRequests });
    }, () => undefined);
  }), [navigation, listing.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scoped: the drill-down starts at the machine type and never goes above it.
  const openNodeId = openId ?? scope?.id ?? null;
  const open = findNode(tree, openNodeId);
  const rows = open ? open.children : tree;
  const crumbs = nodePath(tree, openNodeId);
  const canGoUp = !!open && open.id !== scope?.id;
  const hits = useMemo(
    () => searchCategories(scope ? [scope] : tree, listing.kind, query),
    [tree, scope, listing.kind, query],
  );
  const recents = useMemo(
    () => recentNodes(tree, listing.kind, recent).filter((n) => !scope || scopeIds.has(n.id)),
    [tree, listing.kind, recent, scope, scopeIds],
  );
  const pickedPath = nodePath(tree, picked).map((n) => n.name).join(' › ');

  const s = useMemo(() => StyleSheet.create({
    crumbs: { ...type('caption'), color: colors.textSecondary },
    picked: { ...type('bodyStrong'), color: colors.text },
  }), [colors, type]);

  const pick = (n: CategoryNode) => {
    if (locked) return;
    if (n.level === level) setPicked(n.id);
    else setOpenId(n.id);
  };

  const nodeRow = (n: CategoryNode, last: boolean, hint?: string) => {
    const leaf = n.level === level;
    return (
      <ListRow
        key={n.id}
        label={n.name}
        hint={hint}
        selected={leaf && picked === n.id}
        chevron={!leaf}
        last={last}
        disabled={locked}
        onPress={() => pick(n)}
        testID={leaf ? 'Sell-category-option' : 'Sell-category-open'}
        accessibilityRole={leaf ? 'radio' : 'button'}
        accessibilityState={leaf ? { selected: picked === n.id } : undefined}
      />
    );
  };

  return (
    <StepFrame
      ctx={ctx}
      patch={() => (picked && picked !== initial ? { categoryId: picked } : null)}
      validate={() => {
        setTried(true);
        // The device's recent picks (R28), kept when the seller moves on with a category.
        if (picked) void writeRecent(level, pushRecent(recent, picked));
        return !!picked;
      }}
      nextDisabled={locked && !listing.categoryId}
    >
      {locked ? <Notice tone="info" icon={Info} text={t('listing.errors.categoryLocked')} /> : null}
      {scope && request.data ? (
        <Notice
          tone="info"
          icon={ClipboardList}
          title={t('buyers.sell.scopeTitle', { name: request.data.name })}
          text={t('buyers.sell.scopeBody', { type: scope.name })}
        />
      ) : null}
      {pickedPath ? (
        <Card>
          <Text style={s.crumbs}>{t('sell.category.picked')}</Text>
          <Text style={s.picked}>{pickedPath}</Text>
        </Card>
      ) : null}
      <Input
        placeholder={t(listing.kind === 'part' ? 'sell.category.searchParts' : 'sell.category.searchMachines')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        editable={!locked}
        testID="Sell-category-search"
      />
      {query.trim() ? (
        <Card flush>
          {hits.map((h, i) => nodeRow(h.node, i === hits.length - 1, h.path.join(' › ')))}
          {hits.length === 0 ? <ListRow icon={Search} label={t('sell.picker.noMatch')} last /> : null}
        </Card>
      ) : (
        <>
          {recents.length > 0 && !openNodeId ? (
            <Field label={t('sell.category.recent')}>
              <Card flush>
                {recents.map((n, i) => nodeRow(n, i === recents.length - 1, nodePath(tree, n.parentId).map((p) => p.name).join(' › ')))}
              </Card>
            </Field>
          ) : null}
          <Field label={crumbs.length > 0 ? crumbs.map((c) => c.name).join(' › ') : t('sell.category.browse')}>
            <Card flush>
              {open && canGoUp ? (
                <ListRow
                  icon={ChevronLeft}
                  label={t('sell.category.up')}
                  onPress={() => setOpenId(open.parentId)}
                  testID="Sell-category-up"
                />
              ) : null}
              {rows.map((n, i) => nodeRow(n, i === rows.length - 1))}
            </Card>
          </Field>
        </>
      )}
      {tried && !picked ? <FieldError>{t('sell.category.required')}</FieldError> : null}
      {listing.kind === 'part' && recents.length === 0 && !query.trim() && !openNodeId ? (
        <Notice tone="info" icon={Clock} text={t('sell.category.tip')} />
      ) : null}
    </StepFrame>
  );
}

