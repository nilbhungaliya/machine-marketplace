import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import { SignInSheetContext, type SignInRequest, type SignInSheetApi } from '@/hooks/use-require-sign-in';
import { track } from '@/lib/analytics';
import { AUTH_EVENTS } from '@/lib/analytics-events';
import type { SignInReason } from '@/lib/sign-in-gate';
import { spacing } from '@/lib/theme';
import { navigationRef } from '@/navigation/navigationRef';
import { setPending } from '@/store/authSlice';
import type { AppDispatch } from '@/store';

interface SignInSheetProps {
  visible: boolean;
  reason: SignInReason;
  onContinue: () => void;
  onClose: () => void;
}

/** The sign-in sheet (F4 + F5 spec §8.1): why an account is needed for this action, Continue with mobile number, Not now. */
export default function SignInSheet({ visible, reason, onContinue, onClose }: SignInSheetProps) {
  const { t } = useTranslation();
  const s = useMemo(() => StyleSheet.create({ actions: { gap: spacing.sm, paddingTop: spacing.xs } }), []);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(`auth.signInSheet.title.${reason}`)}
      subtitle={t(`auth.signInSheet.body.${reason}`)}
      closeLabel={t('auth.signInSheet.notNow')}
      testID="Sign-in-sheet-backdrop"
    >
      <View style={s.actions}>
        <Button title={t('auth.signInSheet.cta')} phLabel="Sign-in-sheet-continue" onPress={onContinue} />
        <Button title={t('auth.signInSheet.notNow')} phLabel="Sign-in-sheet-not-now" variant="ghost" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

/** Opens the phone screen; the guest stack and the signed-out stack both hold `Auth`. */
function openPhoneScreen(): void {
  if (navigationRef.isReady()) navigationRef.navigate('Auth');
}

/**
 * Holds the one sign-in sheet (mounted once in App.tsx, inside the Redux provider). "Continue" keeps the request's
 * pending action in the auth slice (or clears an older one) and opens the phone screen; "Not now", the backdrop and Back
 * drop it.
 */
export function SignInSheetProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();
  const [request, setRequest] = useState<SignInRequest | null>(null);
  // Kept after close so the copy doesn't change while the sheet slides away.
  const [reason, setReason] = useState<SignInReason>('save');

  const api = useMemo<SignInSheetApi>(() => ({
    open(next) {
      track(AUTH_EVENTS.signInPrompted, { reason: next.reason });
      setReason(next.reason);
      setRequest(next);
    },
    start() {
      dispatch(setPending(null));
      openPhoneScreen();
    },
  }), [dispatch]);

  const onContinue = useCallback(() => {
    if (!request) return;
    dispatch(setPending(request.pending ?? null));
    setRequest(null);
    openPhoneScreen();
  }, [dispatch, request]);

  const onClose = useCallback(() => {
    if (!request) return;
    track(AUTH_EVENTS.signInPromptDismissed, { reason: request.reason });
    dispatch(setPending(null));
    setRequest(null);
  }, [dispatch, request]);

  return (
    <SignInSheetContext.Provider value={api}>
      {children}
      <SignInSheet visible={request !== null} reason={reason} onContinue={onContinue} onClose={onClose} />
    </SignInSheetContext.Provider>
  );
}
