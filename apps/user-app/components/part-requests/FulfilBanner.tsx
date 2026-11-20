import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Button from '@/components/Button';
import Notice from '@/components/Notice';
import { CircleCheck } from '@/lib/icons';
import { spacing } from '@/lib/theme';

/** "Not yet" is remembered per request and deal on this device (F8 spec §9.4, (my call) 22). */
const dismissedKey = (requestId: string, dealId: string) => `fulfil-prompt-dismissed:${requestId}:${dealId}`;

async function readDismissed(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch {
    return false;
  }
}

async function writeDismissed(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch {
    // A preference only: the banner shows again next time.
  }
}

/**
 * "Mark this requirement fulfilled?" (F8 spec §9.4, R3): shown on an active requirement while a non-cancelled deal
 * (disputed included) exists on one of its reply or match listings — the view's `fulfilPrompt`. Never automatic:
 * **Mark fulfilled** sends the deal id; **Not yet** hides it on this device for this deal.
 */
export default function FulfilBanner({ requestId, prompt, busy, onFulfil, style }: {
  requestId: string;
  prompt: { dealId: string; businessName: string };
  busy: boolean;
  onFulfil: (dealId: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const key = dismissedKey(requestId, prompt.dealId);
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void readDismissed(key).then((d) => { if (live) setHidden(d); });
    return () => { live = false; };
  }, [key]);

  if (hidden !== false) return null;
  return (
    <Notice
      tone="success"
      icon={CircleCheck}
      title={t('requirements.fulfil.title')}
      text={t('requirements.fulfil.body', { name: prompt.businessName })}
      style={style}
    >
      <View style={s.row}>
        <Button title={t('requirements.fulfil.mark')} size="sm" loading={busy} phLabel="Requirement-fulfil-prompt-mark" onPress={() => onFulfil(prompt.dealId)} />
        <Button
          title={t('requirements.fulfil.notYet')}
          size="sm"
          variant="ghost"
          phLabel="Requirement-fulfil-prompt-not-yet"
          onPress={() => {
            setHidden(true);
            void writeDismissed(key);
          }}
        />
      </View>
    </Notice>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm },
});
