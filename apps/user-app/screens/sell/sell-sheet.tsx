import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AppToast from '@/components/AppToast';
import Card from '@/components/Card';
import Field from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import { useSheetAnimation } from '@/hooks/use-sheet-animation';
import { useType } from '@/hooks/use-type';
import { ChevronRight, Search } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

// The sell wizard's sheets: a bottom sheet for a form (the fit row) and a picker (brand, model, unit) with search and
// sections. Kept in the sell folder: ActionSheet (components/) is a plain list without a search box or footer.

interface SellSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned under the scrolling body (a FooterBar-like row of buttons). */
  footer?: React.ReactNode;
  testID?: string;
}

/** A bottom sheet in a transparent Modal (`use-sheet-animation`); the backdrop and hardware Back close it. */
export function SellSheet({ visible, title, onClose, children, footer, testID }: SellSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();
  const { rendered, backdropOpacity, translateY } = useSheetAnimation(visible);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  const s = useMemo(() => StyleSheet.create({
    wrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
    fill: { flex: 1 },
    card: {
      backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
      paddingTop: 10, maxHeight: '90%',
    },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
    title: { ...type('sheetTitle'), color: colors.text, paddingHorizontal: spacing.xl, marginBottom: spacing.md },
    body: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.lg },
    footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  }), [colors, type]);

  if (!rendered) return null;
  return (
    <Modal transparent visible={rendered} animationType="none" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable
            style={s.fill}
            onPress={onClose}
            testID="Sell-sheet-backdrop"
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          />
        </Animated.View>
        <Animated.View
          style={[s.card, { paddingBottom: insets.bottom + spacing.lg, transform: [{ translateY }] }]}
          testID={testID}
        >
          <View style={s.handle} />
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
            {children}
          </ScrollView>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
      <AppToast inModal />
    </Modal>
  );
}

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
  /** Translated section title; options keep their order inside a section, sections their first appearance. */
  section?: string;
}

interface PickerSheetProps {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  /** Rows after the list that are always shown (Other…, All models). */
  extra?: PickerOption[];
  testID: string;
}

/** Show a search box once a list is longer than this. */
const SEARCH_FROM = 8;

/** A single choice from a list, in a sheet: search, sections, the chosen row ticked. Picking closes it. */
export function PickerSheet({ visible, title, options, selectedId, onPick, onClose, extra = [], testID }: PickerSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [query, setQuery] = useState('');
  useEffect(() => { if (!visible) setQuery(''); }, [visible]);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const sections = useMemo(() => {
    const out: { title: string | undefined; rows: PickerOption[] }[] = [];
    for (const o of shown) {
      const last = out.at(-1);
      if (last && last.title === o.section) last.rows.push(o);
      else out.push({ title: o.section, rows: [o] });
    }
    return out;
  }, [shown]);

  const s = useMemo(() => StyleSheet.create({
    section: { ...type('label'), color: colors.textMuted, marginTop: spacing.xs },
  }), [colors, type]);

  const row = (o: PickerOption, last: boolean) => (
    <ListRow
      key={o.id}
      label={o.label}
      hint={o.hint}
      selected={o.id === selectedId}
      last={last}
      onPress={() => { onPick(o.id); onClose(); }}
      testID={`${testID}-option`}
      accessibilityRole="radio"
      accessibilityState={{ selected: o.id === selectedId }}
    />
  );

  return (
    <SellSheet visible={visible} title={title} onClose={onClose} testID={testID}>
      {options.length >= SEARCH_FROM ? (
        <Input placeholder={t('sell.picker.search')} value={query} onChangeText={setQuery} autoCorrect={false} testID={`${testID}-search`} />
      ) : null}
      {sections.map((sec, i) => (
        <View key={`${sec.title ?? ''}-${i}`} style={{ gap: spacing.sm }}>
          {sec.title ? <Text style={s.section}>{sec.title}</Text> : null}
          <Card flush>{sec.rows.map((o, j) => row(o, j === sec.rows.length - 1))}</Card>
        </View>
      ))}
      {q && shown.length === 0 ? (
        <Card flush><ListRow icon={Search} label={t('sell.picker.noMatch')} last /></Card>
      ) : null}
      {extra.length > 0 ? <Card flush>{extra.map((o, j) => row(o, j === extra.length - 1))}</Card> : null}
    </SellSheet>
  );
}

interface PickerFieldProps {
  label: string;
  /** The chosen value's text; `placeholder` when empty. */
  value: string | null;
  placeholder: string;
  hint?: string;
  error?: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** A filled field that opens a picker (looks like `Input`, with a chevron). */
export function PickerField({ label, value, placeholder, hint, error, onPress, disabled, testID, style }: PickerFieldProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    box: {
      minHeight: 52, borderRadius: radius.md, backgroundColor: colors.field, paddingHorizontal: spacing.lg,
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.field,
    },
    error: { borderColor: colors.danger },
    value: { flex: 1, ...type('fieldValue'), color: colors.text },
    placeholder: { flex: 1, ...type('fieldValue'), color: colors.textMuted },
    disabled: { opacity: 0.5 },
  }), [colors, type]);
  return (
    <Field label={label} hint={hint} error={error} style={style}>
      <Pressable
        style={[s.box, error ? s.error : null, disabled ? s.disabled : null]}
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
      >
        <Text style={value ? s.value : s.placeholder} numberOfLines={1}>{value ?? placeholder}</Text>
        <ChevronRight size={18} color={colors.textMuted} />
      </Pressable>
    </Field>
  );
}
