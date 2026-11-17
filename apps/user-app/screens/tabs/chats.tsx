import React from 'react';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import { TAB_ICONS } from '@/lib/icons';

export default function ChatsScreen() {
  const { t } = useTranslation();
  return (
    <ScreenWrapper edges={['top']}>
      <Header title={t('chats.title')} showBack={false} />
      <EmptyState icon={TAB_ICONS.chats} title={t('chats.emptyTitle')} subtitle={t('chats.emptySubtitle')} />
    </ScreenWrapper>
  );
}
