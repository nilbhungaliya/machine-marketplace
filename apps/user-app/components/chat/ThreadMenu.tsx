import React from 'react';
import { useTranslation } from 'react-i18next';
import ActionSheet, { type ActionSheetItem } from '@/components/ActionSheet';
import { Archive, Ban, Flag, Inbox, Share2 } from '@/lib/icons';

export type ThreadMenuAction = 'share' | 'report' | 'block' | 'archive' | 'unarchive';

interface ThreadMenuProps {
  visible: boolean;
  /** The other business, under the title. */
  counterpartName: string;
  archived: boolean;
  /** A `viewer` reads only: report and block are hidden; archive stays (P15). */
  viewer: boolean;
  /** False once this business blocked the other one. */
  canBlock: boolean;
  onSelect: (action: ThreadMenuAction) => void;
  onClose: () => void;
}

/** The thread's ⋮ menu (§15.1): share the listing, report the conversation, block the business, archive / unarchive. */
export default function ThreadMenu({ visible, counterpartName, archived, viewer, canBlock, onSelect, onClose }: ThreadMenuProps) {
  const { t } = useTranslation();
  const items: ActionSheetItem[] = [
    { key: 'share', label: t('chats.menu.share'), icon: Share2, testID: 'Thread-menu-share' },
    archived
      ? { key: 'unarchive', label: t('chats.menu.unarchive'), icon: Inbox, testID: 'Thread-menu-unarchive' }
      : { key: 'archive', label: t('chats.menu.archive'), icon: Archive, testID: 'Thread-menu-archive' },
    ...(viewer ? [] : [{ key: 'report', label: t('chats.menu.report'), icon: Flag, testID: 'Thread-menu-report' }]),
    ...(viewer || !canBlock
      ? []
      : [{ key: 'block', label: t('chats.menu.block'), icon: Ban, destructive: true, testID: 'Thread-menu-block' }]),
  ];
  return (
    <ActionSheet
      visible={visible}
      title={counterpartName}
      items={items}
      onSelect={(key) => onSelect(key as ThreadMenuAction)}
      onClose={onClose}
    />
  );
}
