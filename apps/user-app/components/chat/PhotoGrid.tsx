import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { SignedPhoto } from '@mpm/shared-types';
import IconButton from '@/components/IconButton';
import { useType } from '@/hooks/use-type';
import { X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface PhotoGridProps {
  photos: SignedPhoto[];
  /** The message id, for test ids. */
  messageId: string;
  /** A photo failed to load: its signed URL (300 s) may have expired; the screen refetches the page. */
  onExpired?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A chat message's photos (§6.8): up to five square tiles from private signed URLs; a tap opens the photo full screen.
 * URLs live 300 s, so a load error asks the screen to refetch fresh ones. Private photos stay in memory, never on disk.
 */
export default function PhotoGrid({ photos, messageId, onExpired, style }: PhotoGridProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<number | null>(null);
  const size = photos.length === 1 ? 200 : 104;

  const s = useMemo(() => StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    tile: { width: size, height: size, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.photo },
    image: { width: '100%', height: '100%' },
    viewer: { flex: 1, backgroundColor: colors.photo, justifyContent: 'center' },
    full: { width: '100%', height: '80%' },
    bar: {
      position: 'absolute', left: spacing.lg, right: spacing.lg, top: insets.top + spacing.sm,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    count: { ...type('label'), color: colors.text },
  }), [colors, type, size, insets.top]);

  const current = open !== null ? photos[open] : undefined;

  return (
    <View style={[s.grid, style]}>
      {photos.map((p, i) => (
        <Pressable
          key={`${i}-${p.url}`}
          style={s.tile}
          onPress={() => setOpen(i)}
          testID={`Thread-photo-${messageId}-${i}`}
          accessibilityRole="imagebutton"
          accessibilityLabel={t('chats.thread.photo', { n: i + 1, total: photos.length })}
        >
          <Image source={{ uri: p.url }} style={s.image} contentFit="cover" cachePolicy="memory" transition={150} onError={onExpired} accessibilityIgnoresInvertColors />
        </Pressable>
      ))}
      <Modal visible={current !== undefined} transparent={false} animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={s.viewer}>
          {current ? <Image source={{ uri: current.url }} style={s.full} contentFit="contain" cachePolicy="memory" onError={onExpired} accessibilityIgnoresInvertColors /> : null}
          <View style={s.bar}>
            <Text style={s.count}>{open !== null ? t('chats.thread.photo', { n: open + 1, total: photos.length }) : ''}</Text>
            <IconButton icon={X} onPress={() => setOpen(null)} accessibilityLabel={t('chats.thread.closePhoto')} testID="Thread-photo-close" />
          </View>
        </View>
      </Modal>
    </View>
  );
}
