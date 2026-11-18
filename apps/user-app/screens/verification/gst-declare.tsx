import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import FooterBar from '@/components/FooterBar';
import { businessKeys, gstStateQuery } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { GST_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { declareGst, sendGstCode } from '@/lib/gst-api';
import { GST_ERROR_KEYS, gstScreen } from '@/lib/gst-flow';
import { Square, SquareCheck } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * The declaration (spec §5.2 step 4; wording version `GST_DECLARATION_VERSION`), then the code to the GSTIN's
 * registered contact (step 5). Declaring again reuses the open attempt, so a retry after an outage is safe.
 */
export default function GstDeclareScreen({ navigation, route }: RootStackScreenProps<'GstDeclare'>) {
  const { checkId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const declareAndSend = async () => {
    setBusy(true);
    try {
      const declared = await declareGst(checkId);
      queryClient.setQueryData(businessKeys.gst, declared);
      if (!declared.proofId) throw Object.assign(new Error('GST_PROOF_CLOSED'), { code: 'GST_PROOF_CLOSED' });
      const sent = await sendGstCode(declared.proofId);
      queryClient.setQueryData(businessKeys.gst, sent);
      track(GST_EVENTS.codeSent, { resend: false });
      openTarget(navigation, gstScreen(sent), 'replace');
    } catch (err) {
      const code = errorCode(err);
      track(GST_EVENTS.codeSendFailed, { reason: code });
      Toast.show({ type: 'error', text1: t(errorKey(err, GST_ERROR_KEYS)) });
      // Unavailable or rate-limited: stay and try again. Anything else moved the state on: open what it is now.
      if (code !== 'GST_UNAVAILABLE' && code !== 'RATE_LIMITED' && code !== 'ERR_NETWORK') {
        try {
          const fresh = await queryClient.fetchQuery(gstStateQuery);
          openTarget(navigation, gstScreen(fresh), 'replace');
        } catch {
          // Stay; the toast said what went wrong.
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.lg },
    heading: { gap: spacing.sm },
    title: { ...type('title'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary },
    // A choice card (v2 `.choice`): hairline when idle, a violet border on lavender when ticked.
    card: {
      flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5,
      backgroundColor: agreed ? colors.primaryWash : colors.surface, borderColor: agreed ? colors.primary : colors.hairline,
    },
    declaration: { flex: 1, ...type('bodyStrong'), color: colors.text },
    fine: { ...type('caption'), color: colors.textMuted },
  }), [colors, type, agreed]);

  return (
    <ScreenWrapper scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <View style={s.heading}>
          <Text style={s.title}>{t('verification.declare.title')}</Text>
          <Text style={s.subtitle}>{t('verification.declare.subtitle')}</Text>
        </View>
        <Pressable
          style={s.card}
          onPress={() => setAgreed((a) => !a)}
          testID="Gst-declaration"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
        >
          {agreed ? <SquareCheck size={22} color={colors.primary} /> : <Square size={22} color={colors.textSecondary} />}
          <Text style={s.declaration}>{t('verification.declare.text')}</Text>
        </Pressable>
        <Text style={s.fine}>{t('verification.declare.codeNote')}</Text>
      </View>
      <FooterBar>
        <Button
          title={t('verification.declare.sendCode')}
          phLabel="Gst-declare-send-code"
          size="md"
          disabled={!agreed}
          loading={busy}
          onPress={() => void declareAndSend()}
        />
      </FooterBar>
    </ScreenWrapper>
  );
}
