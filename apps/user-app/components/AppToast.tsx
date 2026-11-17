import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import Toast, { type ToastConfig, type ToastConfigParams, type ToastShowParams } from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, TriangleAlert, Info, type LucideIcon } from '@/lib/icons';
import { useTheme, fonts, type ThemeColors } from '@/lib/theme';
import { useLanguage } from '@/lib/i18n/language';
import { scriptLineHeight } from '@/lib/i18n/script';
import { DEFAULT_VISIBLE_MS, recordShown, clearShown, takePending } from '@/components/toast-handoff';

type Variant = 'success' | 'error' | 'info';

type ToastExtras = { durationMs?: number } | undefined;

type ShowFn = (params: ToastShowParams) => void;

/**
 * Record at `show` rather than on render: a sheet that toasts and closes in one
 * tick has its `Modal` return null in that same commit, so the card is deleted
 * before it displays and its effects never fire. See `toast-handoff.ts`.
 *
 * `durationMs` rides in `props` because the config component is not given
 * `visibilityTime`. The original `show` is stashed so Fast Refresh re-running
 * this file wraps the library again, not the wrapper.
 */
const patchable = Toast as unknown as { show: ShowFn; __mpm_baseShow?: ShowFn };
const baseShow: ShowFn = patchable.__mpm_baseShow ?? patchable.show;
patchable.__mpm_baseShow = baseShow;
patchable.show = (params) => {
  recordShown(params);
  baseShow({
    ...params,
    props: { ...params.props, durationMs: params.visibilityTime ?? DEFAULT_VISIBLE_MS },
  });
};

// Success splits its yellow: `primary` reads as a 3px rail on white but is
// invisible as a glyph on the pale gold chip, which takes `primaryDark`.
function variantStyle(variant: Variant, colors: ThemeColors): { Glyph: LucideIcon; chip: string; icon: string; rail: string } {
  switch (variant) {
    case 'success':
      return { Glyph: CircleCheck, chip: colors.primaryMuted, icon: colors.primaryDark, rail: colors.primary };
    case 'error':
      return { Glyph: TriangleAlert, chip: colors.redMuted, icon: colors.red, rail: colors.red };
    case 'info':
      return { Glyph: Info, chip: colors.blueMuted, icon: colors.blue, rail: colors.blue };
  }
}

/** The house card from `VehicleCard`, plus a status chip and a draining rail. */
function ToastCard({ variant, text1, text2, isVisible, hide, onPress, props }: ToastConfigParams<ToastExtras> & { variant: Variant }) {
  const { colors, cardShadow } = useTheme();
  const lang = useLanguage();
  const { Glyph, chip, icon, rail } = variantStyle(variant, colors);
  const durationMs = props?.durationMs ?? DEFAULT_VISIBLE_MS;

  // Already seen — auto-hidden or tapped away — so closing a sheet later must
  // not replay it. Nothing on unmount: that is the case the hand-off is for.
  useEffect(() => {
    if (!isVisible) clearShown(text1, text2);
  }, [isVisible, text1, text2]);

  // Keyed on the copy too, so a toast arriving while one is up restarts the
  // rail instead of inheriting a half-drained one.
  const drain = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isVisible) return undefined;
    drain.setValue(1);
    const run = Animated.timing(drain, {
      toValue: 0,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [isVisible, text1, text2, durationMs, drain]);

  const s = useMemo(() => StyleSheet.create({
    shell: {
      flexDirection: 'row',
      alignItems: 'center',
      // Matches the screens' `paddingHorizontal`, so it lines up with the
      // cards underneath rather than sitting proud of them.
      alignSelf: 'stretch',
      marginHorizontal: 20,
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      // Clips the rail to the radius. Safe alongside `cardShadow` — Android
      // draws elevation outside the view, so this only affects children.
      overflow: 'hidden',
      ...cardShadow,
    },
    chip: {
      width: 34,
      height: 34,
      borderRadius: 11,
      marginLeft: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: chip,
    },
    // Bottom padding clears the rail's 3px.
    copy: { flex: 1, paddingTop: 11, paddingBottom: 13, paddingLeft: 11, paddingRight: 14 },
    text1: {
      fontFamily: fonts.display,
      fontSize: 14.5,
      lineHeight: scriptLineHeight(lang, 14.5, 19),
      color: colors.text,
    },
    text2: {
      fontFamily: fonts.regular,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
      marginTop: 2,
    },
    rail: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 3,
      backgroundColor: rail,
      // `scaleX`, not an animated width, to stay on the native driver: a toast
      // lands just as a request settles, when the JS thread is busiest.
      transformOrigin: 'left center',
    },
  }), [colors, cardShadow, chip, rail, lang]);

  return (
    <Pressable
      style={s.shell}
      // Tapping always dismisses; a caller's own onPress still runs.
      onPress={() => { onPress?.(); hide(); }}
      accessibilityRole="alert"
      accessibilityLabel={[text1, text2].filter(Boolean).join('. ')}
    >
      <View style={s.chip}>
        <Glyph size={20} color={icon} strokeWidth={2.2} />
      </View>
      <View style={s.copy}>
        {text1 ? <Text style={s.text1} numberOfLines={2}>{text1}</Text> : null}
        {text2 ? <Text style={s.text2} numberOfLines={2}>{text2}</Text> : null}
      </View>
      <Animated.View style={[s.rail, { transform: [{ scaleX: drain }] }]} pointerEvents="none" />
    </Pressable>
  );
}

export const toastConfig: ToastConfig = {
  success: (props) => <ToastCard {...props} variant="success" />,
  error: (props) => <ToastCard {...props} variant="error" />,
  info: (props) => <ToastCard {...props} variant="info" />,
};

/**
 * Mount at the app root, and with `inModal` as the last child of every `Modal`.
 *
 * A `Modal` is its own native window, so the root toast renders underneath any
 * open sheet. The library shows on the most recently mounted instance, so one
 * inside the modal takes over while it is open and hands back on unmount —
 * which is what carries a toast through the save / toast / close flow.
 */
export default function AppToast({ inModal = false }: { inModal?: boolean }) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!inModal) return undefined;
    return () => {
      const pending = takePending();
      if (!pending) return;
      // Deferred: this instance's ref is removed in the same commit as this
      // cleanup, so showing now would land back on the instance going away.
      setTimeout(() => Toast.show(pending), 0);
    };
  }, [inModal]);

  return <Toast config={toastConfig} topOffset={insets.top + 8} />;
}
