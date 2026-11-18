import React from 'react';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { Search } from '@/lib/icons';

export default function SearchScreen() {
  const { t } = useTranslation();
  // The floating tab bar draws over the screen's bottom (spec §7.5).
  const tabInset = useTabBarInset();
  return (
    <ScreenWrapper edges={['top']}>
      <Header title={t('search.title')} showBack={false} />
      <EmptyState icon={Search} title={t('search.emptyTitle')} subtitle={t('search.emptySubtitle')} style={{ paddingBottom: tabInset }} />
    </ScreenWrapper>
  );
}
