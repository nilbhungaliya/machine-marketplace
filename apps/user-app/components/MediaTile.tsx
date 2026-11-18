import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { ImagePlus, Play, RotateCcw, Star, X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import type { MediaTileState } from '@/lib/media-upload';

export type { MediaTileState };

interface MediaTileProps {
  /** The photo's thumb or the video's poster (a remote URL, or the local file while uploading). */
  uri: string | null;
  type: 'photo' | 'video';
  /** An upload item's status maps with `tileState()` (`lib/media-upload.ts`): `attaching` draws as `uploading`. */
  state?: MediaTileState;
  /** 0–1 while uploading. */
  progress?: number;
  /** The first photo: the yellow "Cover" badge (`coverLabel`). */
  cover?: boolean;
  coverLabel?: string;
  /** Failed: the message and a retry button (`retryLabel` is its accessibility label). */
  errorText?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** "Make cover" (photos that aren't the cover). */
  onMakeCover?: () => void;
  makeCoverLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  /** Tap on the picture (open it). */
  onPress?: () => void;
  /** Accessibility label of the picture. */
  label?: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A photo or video tile of the media step (v2 `.photos .ph`, F2 spec §15.2): the picture, a play badge on videos, the
 * Cover badge, upload progress, an error with retry, Make cover and delete. Square; the caller sets the width.
 */
export default function MediaTile({
  uri, type, state = 'done', progress = 0, cover = false, coverLabel, errorText, onRetry, retryLabel, onMakeCover,
  makeCoverLabel, onDelete, deleteLabel, onPress, label, testID, style,
}: MediaTileProps) {
  const { colors, shadows } = useTheme();
  const typeScale = useType();
  const s = useMemo(() => StyleSheet.create({
    tile: { aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden' },
    image: { width: '100%', height: '100%' },
    center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    play: {
      width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center', ...shadows.raised,
    },
    dim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
    bar: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.sm, height: 4, borderRadius: 2, backgroundColor: colors.surface },
    barFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
    failed: {
      ...StyleSheet.absoluteFillObject, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center',
      padding: spacing.xs, gap: spacing.xs,
    },
    failedText: { ...typeScale('badge'), color: colors.danger, textAlign: 'center' },
    retry: {
      width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center', borderWidth: 1, borderColor: colors.danger,
    },
    corner: {
      position: 'absolute', top: spacing.xs, right: spacing.xs, width: 28, height: 28, borderRadius: radius.full,
      backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.raised,
    },
    cover: {
      ...typeScale('badge'), position: 'absolute', bottom: spacing.xs, alignSelf: 'center', color: colors.onSun,
      backgroundColor: colors.sun, borderRadius: radius.full, paddingHorizontal: spacing.sm, overflow: 'hidden',
    },
    makeCover: {
      position: 'absolute', bottom: spacing.xs, left: spacing.xs, width: 28, height: 28, borderRadius: radius.full,
      backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.raised,
    },
  }), [colors, shadows, typeScale]);

  const busy = state === 'queued' || state === 'uploading';
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <View style={[s.tile, style]} testID={testID}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'imagebutton' : 'image'}
        accessibilityLabel={label}
        testID={`${testID}-open`}
      >
        {uri ? (
          <Image source={{ uri }} style={s.image} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <View style={s.center}><ImagePlus size={24} color={colors.textMuted} /></View>
        )}
      </Pressable>

      {type === 'video' && !busy && state !== 'failed' ? (
        <View style={s.center} pointerEvents="none">
          <View style={s.play}><Play size={16} color={colors.primaryInk} fill={colors.primaryInk} /></View>
        </View>
      ) : null}

      {busy ? (
        <>
          <View style={s.dim} pointerEvents="none" />
          <View style={s.bar} pointerEvents="none" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
            <View style={[s.barFill, { width: `${pct}%` }]} />
          </View>
        </>
      ) : null}

      {state === 'failed' ? (
        <View style={s.failed}>
          {errorText ? <Text style={s.failedText} numberOfLines={3}>{errorText}</Text> : null}
          {onRetry ? (
            <Pressable
              style={s.retry}
              onPress={onRetry}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={retryLabel}
              testID={`${testID}-retry`}
            >
              <RotateCcw size={16} color={colors.danger} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {cover && coverLabel && state === 'done' ? <Text style={s.cover} pointerEvents="none">{coverLabel}</Text> : null}

      {!cover && onMakeCover && state === 'done' ? (
        <Pressable
          style={s.makeCover}
          onPress={onMakeCover}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={makeCoverLabel}
          testID={`${testID}-make-cover`}
        >
          <Star size={14} color={colors.primaryInk} />
        </Pressable>
      ) : null}

      {onDelete ? (
        <Pressable
          style={s.corner}
          onPress={onDelete}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          testID={`${testID}-delete`}
        >
          <X size={14} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}
