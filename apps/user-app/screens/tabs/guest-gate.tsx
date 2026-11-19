import React from 'react';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import { useRequireSignIn } from '@/hooks/use-require-sign-in';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { TAB_ICONS } from '@/lib/icons';
import type { SignInReason } from '@/lib/sign-in-gate';

type GatedTab = Extract<SignInReason, 'post' | 'chats' | 'deals'>;

const TITLE_KEYS: Record<GatedTab, string> = { post: 'nav.tabs.post', chats: 'chats.title', deals: 'deals.title' };

/**
 * What a guest sees on Post, Chats or Deals (F4 + F5 spec §8.1). The tab press already opens the sign-in sheet
 * (tab-navigator.tsx); this covers a guest who lands here another way (a link to the tab), so the signed-in screen and
 * its API calls never load for a guest.
 */
function GuestGate({ tab }: { tab: GatedTab }) {
  const { t } = useTranslation();
  const tabInset = useTabBarInset();
  const { openSignIn } = useRequireSignIn();
  return (
    <ScreenWrapper edges={['top']}>
      <Header title={t(TITLE_KEYS[tab])} showBack={false} />
      <EmptyState
        icon={TAB_ICONS[tab]}
        title={t(`auth.signInSheet.title.${tab}`)}
        subtitle={t(`auth.signInSheet.body.${tab}`)}
        ctaTitle={t('auth.signInSheet.cta')}
        ctaPhLabel={`Guest-${tab}-sign-in`}
        onCtaPress={openSignIn}
        style={{ paddingBottom: tabInset }}
      />
    </ScreenWrapper>
  );
}

export function GuestPostTab() {
  return <GuestGate tab="post" />;
}

export function GuestChatsTab() {
  return <GuestGate tab="chats" />;
}

export function GuestDealsTab() {
  return <GuestGate tab="deals" />;
}
