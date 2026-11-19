import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Notice from '@/components/Notice';
import { ShieldAlert } from '@/lib/icons';

/**
 * Under the other side's message that asks for advance money or a payment handle (§6.7, R7): a warning, never a block.
 */
export default function ScamWarning({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  return <Notice tone="warning" icon={ShieldAlert} text={t('chats.thread.scamWarning')} style={style} />;
}
