import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Animated, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import Button from '@/components/Button';
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
  const { colors } = useTheme();
  const type = useType();
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
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    // Periwinkle v2 `.sheet` (spec §7.2): no shadow, the scrim sets it apart.
    card: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
      paddingHorizontal: spacing.xl, paddingTop: 10,
    },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.lg },
    title: { ...type('sheetTitle'), color: colors.text, marginBottom: spacing.sm },
    message: { ...type('body'), color: colors.textSecondary, marginBottom: spacing.xl },
    row: { flexDirection: 'row', gap: spacing.md },
    rowBtn: { flex: 1, width: 'auto' },
    // Three choices stack: their labels carry amounts and do not fit side by side.
    stack: { gap: spacing.sm },
    pick: {
      flexDirection: 'row', gap: spacing.md, borderWidth: 1.5, borderColor: colors.hairline, borderRadius: radius.lg,
      padding: spacing.md, backgroundColor: colors.surface,
    },
    pickOn: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, marginTop: 1 },
    radioOn: { borderWidth: 6, borderColor: colors.primary },
    pickTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
    pickTitle: { ...type('cardTitle'), color: colors.text, flexShrink: 1 },
    pickAmount: { ...type('price'), fontSize: 16, color: colors.ok },
    pickNone: { ...type('caption'), fontFamily: fonts.semiBold, color: colors.textMuted },
    pickDetail: { ...type('caption'), color: colors.textSecondary, marginTop: 2 },
  }), [colors, type]);

  if (!rendered || !options) return null;

  const confirmVariant = options.destructive ? 'danger' : 'primary';
  const confirmTitle = options.confirmLabel ?? t('components.confirm.confirm');
  const cancelTitle = options.cancelLabel ?? t('common.cancel');

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
              <Button
                phLabel="Confirm-sheet-confirm"
                variant={confirmVariant}
                style={{ marginTop: spacing.sm }}
                title={options.confirmLabels?.[picked] ?? confirmTitle}
                onPress={picked === 'secondary' ? onSecondary : onConfirm}
              />
              <Button phLabel="Confirm-sheet-dismiss" variant="ghost" title={cancelTitle} onPress={onCancel} />
            </View>
          ) : options.hideCancel ? (
            <Button phLabel="Confirm-sheet-confirm" variant={confirmVariant} title={confirmTitle} onPress={onConfirm} />
          ) : options.secondaryLabel ? (
            <View style={s.stack}>
              <Button phLabel="Confirm-sheet-confirm" variant={confirmVariant} title={confirmTitle} onPress={onConfirm} />
              <Button phLabel="Confirm-sheet-secondary" variant="outline" title={options.secondaryLabel} onPress={onSecondary} />
              <Button phLabel="Confirm-sheet-dismiss" variant="ghost" title={cancelTitle} onPress={onCancel} />
            </View>
          ) : (
            <View style={s.row}>
              <Button phLabel="Confirm-sheet-cancel" variant="outline" style={s.rowBtn} title={cancelTitle} onPress={onCancel} />
              <Button phLabel="Confirm-sheet-confirm" variant={confirmVariant} style={s.rowBtn} title={confirmTitle} onPress={onConfirm} />
            </View>
          )}
        </Animated.View>
      </View>
      {/* Modal is a separate native window; the root toast renders under it. */}
      <AppToast inModal />
    </Modal>
  );
}
