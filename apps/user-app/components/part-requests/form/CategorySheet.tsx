import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CategoryNode, PartRequestKind } from '@mpm/shared-types';
import Card from '@/components/Card';
import Field from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import Skeleton from '@/components/Skeleton';
import { useCategoryTree } from '@/hooks/use-listing';
import { ChevronLeft, Search } from '@/lib/icons';
import { findNode, nodePath, searchCategories } from '@/lib/sell-category';
import { radius } from '@/lib/theme';
import { SellSheet } from '@/screens/sell/sell-sheet';

interface CategorySheetProps {
  visible: boolean;
  kind: PartRequestKind;
  /** The picked node, if any (the drill-down opens at its parent). */
  value: string | null;
  /** A machine category from a search reading: the drill-down opens there (§13.2). */
  seedId?: string | null;
  onPick: (node: CategoryNode) => void;
  onClose: () => void;
}

/**
 * The requirement form's category picker (F8 spec §13.1; plan B2-2, review change 13): a search over the cached tree and
 * a drill-down machine category → machine type → part group, in a sheet. Unlike the sell wizard a **part** request may
 * stop at a machine type ("a part for my CNC lathe, group unknown", §25 item 3): an open machine type offers "Any part
 * of this machine" above its part groups, and a search lists matching machine types after the part groups. A machine
 * request picks a machine type. Uses only `lib/sell-category.ts`'s pure helpers.
 */
export default function CategorySheet({ visible, kind, value, seedId, onPick, onClose }: CategorySheetProps) {
  const { t } = useTranslation();
  const tree = useCategoryTree();
  const nodes = useMemo(() => tree.data ?? [], [tree.data]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Each opening starts at the picked node's parent, else the seed, else the machine categories.
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    const picked = findNode(nodes, value);
    setOpenId(picked ? (kind === 'part' && picked.level === 'machine_type' ? picked.id : picked.parentId) : (seedId ?? null));
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = findNode(nodes, openId);
  const rows = open ? open.children.filter((n) => n.isActive) : nodes.filter((n) => n.isActive);
  const crumbs = nodePath(nodes, openId);

  const hits = useMemo(() => {
    if (!query.trim()) return [];
    const types = searchCategories(nodes, 'machine', query);
    return kind === 'part' ? [...searchCategories(nodes, 'part', query), ...types] : types;
  }, [nodes, kind, query]);

  /** Whether a node is a pick (not a folder) for this kind. */
  const isLeaf = (n: CategoryNode) =>
    kind === 'machine' ? n.level === 'machine_type' : n.level === 'part_group' || (n.level === 'machine_type' && n.children.length === 0);

  const pick = (n: CategoryNode) => {
    onPick(n);
    onClose();
  };

  const nodeRow = (n: CategoryNode, last: boolean, hint?: string) => {
    const leaf = isLeaf(n);
    return (
      <ListRow
        key={n.id}
        label={n.name}
        hint={hint}
        selected={leaf && value === n.id}
        chevron={!leaf}
        last={last}
        onPress={() => {
          if (leaf) return pick(n);
          setQuery('');
          setOpenId(n.id);
        }}
        testID={leaf ? 'Request-category-option' : 'Request-category-open'}
        accessibilityRole={leaf ? 'radio' : 'button'}
        accessibilityState={leaf ? { selected: value === n.id } : undefined}
      />
    );
  };

  // A part request may stop at the open machine type.
  const anyPartRow = kind === 'part' && open?.level === 'machine_type' ? (
    <ListRow
      label={t('requirements.category.anyPart', { name: open.name })}
      hint={t('requirements.category.anyPartHint')}
      selected={value === open.id}
      onPress={() => pick(open)}
      testID="Request-category-any-part"
      accessibilityRole="radio"
      accessibilityState={{ selected: value === open.id }}
    />
  ) : null;

  return (
    <SellSheet visible={visible} title={t('requirements.category.title')} onClose={onClose} testID="Request-category-sheet">
      <Input
        placeholder={t(kind === 'part' ? 'requirements.category.searchParts' : 'requirements.category.searchMachines')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        testID="Request-category-search"
      />
      {tree.isLoading ? (
        <Skeleton style={{ height: 160, borderRadius: radius.xl }} />
      ) : query.trim() ? (
        <Card flush>
          {hits.map((h, i) => nodeRow(h.node, i === hits.length - 1, h.path.join(' › ')))}
          {hits.length === 0 ? <ListRow icon={Search} label={t('requirements.category.noMatch')} last /> : null}
        </Card>
      ) : (
        <Field label={crumbs.length > 0 ? crumbs.map((c) => c.name).join(' › ') : t('requirements.category.browse')}>
          <Card flush>
            {open ? (
              <ListRow icon={ChevronLeft} label={t('requirements.category.up')} onPress={() => setOpenId(open.parentId)} testID="Request-category-up" />
            ) : null}
            {anyPartRow}
            {rows.map((n, i) => nodeRow(n, i === rows.length - 1))}
          </Card>
        </Field>
      )}
    </SellSheet>
  );
}
