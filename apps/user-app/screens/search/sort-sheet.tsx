import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchSort } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';

interface SortSheetProps {
  visible: boolean;
  /** From `sortOptions()`: nearest only with a location, year and hours only for machines (§5.8). */
  options: SearchSort[];
  /** The sort the list uses (the server's, R10 default included). */
  value: SearchSort;
  onPick: (sort: SearchSort) => void;
  onClose: () => void;
}

/** The results' sort sheet (F4 + F5 spec §8.4): one radio row per allowed sort. */
export default function SortSheet({ visible, options, value, onPick, onClose }: SortSheetProps) {
  const { t } = useTranslation();
  return (
    <ActionSheet
      visible={visible}
      title={t('discover.search.sort.title')}
      items={options.map((o) => ({
        key: o,
        label: t(`discover.search.sort.${o}`),
        selected: o === value,
        testID: `Search-sort-${o.replace('_', '-')}`,
      }))}
      onSelect={(key) => {
        onPick(key as SearchSort);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
