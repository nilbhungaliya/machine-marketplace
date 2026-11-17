import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Animated, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, fonts, spacing } from '@/lib/theme';
import { createConfirmManager, type Choice, type ConfirmManager, type ConfirmOptions } from './confirm-manager';
import { useSheetAnimation } from '@/hooks/use-sheet-animation';
import AppToast from '@/components/AppToast';

export type { Choice, ConfirmOptions };

const ConfirmContext = createContext<ConfirmManager | null>(null);

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmSheetProvider');
  return ctx.confirm;
}

/** A three-button sheet: pass `secondaryLabel`. Resolves which button was pressed. */
export function useChoice(): (options: ConfirmOptions) => Promise<Choice> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useChoice must be used within a ConfirmSheetProvider');
  return ctx.choose;
}

export function ConfirmSheetProvider({ children }: { children: React.ReactNode }) {
  const [, force] = useReducer((c: number) => c + 1, 0);
  const managerRef = useRef<ConfirmManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = createConfirmManager(() => force());
  }
  const manager = managerRef.current;

  return (
    <ConfirmContext.Provider value={manager}>
      {children}
      <ConfirmSheet
        visible={manager.visible}
        options={manager.options}
        onConfirm={() => manager.settle(true)}
        onSecondary={() => manager.settle('secondary')}
        onCancel={() => manager.settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

function ConfirmSheet({
  visible, options, onConfirm, onSecondary, onCancel,
}: {
  visible: boolean;
  options: ConfirmOptions | null;
  onConfirm: () => void;
  onSecondary: () => void;
  onCancel: () => void;
}) {
  const { colors, cardShadow } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { rendered, backdropOpacity, translateY } = useSheetAnimation(visible);
  // With choice cards: the one picked, the first each time the sheet opens.
  const [picked, setPicked] = useState<'confirm' | 'secondary'>('confirm');
  useEffect(() => {
    if (options?.picks) setPicked(options.picks[0]?.value ?? 'confirm');
  }, [options]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onCancel(); return true; });
    return () => sub.remove();
  }, [visible, onCancel]);

  const s = useMemo(() => StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingHorizontal: spacing.xl, paddingTop: spacing.md,
      ...cardShadow,
    },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.lg },
    title: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginBottom: spacing.sm },
    message: { fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.xl },
    row: { flexDirection: 'row', gap: spacing.md },
    btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    cancelBtn: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    cancelText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text, textAlign: 'center' },
    // Dark on the yellow button; destructive (red) swaps to white below.
    confirmText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.onPrimary, textAlign: 'center' },
    confirmTextOnRed: { color: colors.white },
    // Three choices stack: their labels carry amounts and do not fit side by side.
    stack: { gap: spacing.sm },
    stackBtn: { paddingVertical: 14, paddingHorizontal: spacing.md, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    dismissBtn: { paddingVertical: 12, alignItems: 'center' },
    pick: {
      flexDirection: 'row', gap: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14,
      padding: spacing.md, backgroundColor: colors.surface,
    },
    pickOn: { borderColor: colors.text },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border, marginTop: 1 },
    radioOn: { borderWidth: 5, borderColor: colors.text },
    pickTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
    pickTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, flexShrink: 1 },
    pickAmount: { fontFamily: fonts.displayHeavy, fontSize: 15, color: colors.green },
    pickNone: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.textMuted },
    pickDetail: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary, marginTop: 2 },
  }), [colors, cardShadow]);

  if (!rendered || !options) return null;

  const confirmBg = options.destructive ? colors.red : colors.primary;
  const confirmText = [s.confirmText, options.destructive && s.confirmTextOnRed];

  return (
    // animationType 'none': the native slide moves the whole window, dragging the
    // backdrop up and down with the card instead of fading it in place.
    <Modal transparent visible={rendered} animationType="none" onRequestClose={onCancel}>
      <View style={s.sheetWrap}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={{ flex: 1 }} onPress={onCancel} />
        </Animated.View>
        <Animated.View style={[s.card, { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] }]}>
          <View style={s.handle} />
          <Text style={s.title}>{options.title}</Text>
          {options.message ? <Text style={s.message}>{options.message}</Text> : null}
          {options.picks ? (
            <View style={s.stack}>
              {options.picks.map((p) => {
                const on = p.value === picked;
                const choosable = options.picks!.length > 1;
                return (
                  <Pressable
                    key={p.value}
                    ph-label="Confirm-sheet-pick"
                    style={[s.pick, on && choosable && s.pickOn]}
                    disabled={!choosable}
                    onPress={() => setPicked(p.value)}
                    accessibilityRole={choosable ? 'radio' : undefined}
                    accessibilityState={choosable ? { selected: on } : undefined}
                  >
                    {choosable ? <View style={[s.radio, on && s.radioOn]} /> : null}
                    <View style={{ flex: 1 }}>
                      <View style={s.pickTop}>
                        <Text style={s.pickTitle}>{p.title}</Text>
                        {p.amount ? <Text style={s.pickAmount}>{p.amount}</Text> : <Text style={s.pickNone}>{t('components.confirm.noRefund')}</Text>}
                      </View>
                      <Text style={s.pickDetail}>{p.detail}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                ph-label="Confirm-sheet-confirm"
                style={[s.stackBtn, { backgroundColor: confirmBg, marginTop: spacing.sm }]}
                onPress={picked === 'secondary' ? onSecondary : onConfirm}
              >
                <Text style={confirmText}>{options.confirmLabels?.[picked] ?? options.confirmLabel ?? t('components.confirm.confirm')}</Text>
              </Pressable>
              <Pressable ph-label="Confirm-sheet-dismiss" style={s.dismissBtn} onPress={onCancel}>
                <Text style={s.cancelText}>{options.cancelLabel ?? t('common.cancel')}</Text>
              </Pressable>
            </View>
          ) : options.hideCancel ? (
            <Pressable ph-label="Confirm-sheet-confirm" style={[s.stackBtn, { backgroundColor: confirmBg }]} onPress={onConfirm}>
              <Text style={confirmText}>{options.confirmLabel ?? t('components.confirm.confirm')}</Text>
            </Pressable>
          ) : options.secondaryLabel ? (
            <View style={s.stack}>
              <Pressable ph-label="Confirm-sheet-confirm" style={[s.stackBtn, { backgroundColor: confirmBg }]} onPress={onConfirm}>
                <Text style={confirmText}>{options.confirmLabel ?? t('components.confirm.confirm')}</Text>
              </Pressable>
              <Pressable ph-label="Confirm-sheet-secondary" style={[s.stackBtn, s.cancelBtn]} onPress={onSecondary}>
                <Text style={s.cancelText}>{options.secondaryLabel}</Text>
              </Pressable>
              <Pressable ph-label="Confirm-sheet-dismiss" style={s.dismissBtn} onPress={onCancel}>
                <Text style={s.cancelText}>{options.cancelLabel ?? t('common.cancel')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.row}>
              <Pressable style={[s.btn, s.cancelBtn]} onPress={onCancel}>
                <Text style={s.cancelText}>{options.cancelLabel ?? t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={[s.btn, { backgroundColor: confirmBg }]} onPress={onConfirm}>
                <Text style={confirmText}>{options.confirmLabel ?? t('components.confirm.confirm')}</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>
      </View>
      {/* Modal is a separate native window; the root toast renders under it. */}
      <AppToast inModal />
    </Modal>
  );
}
