import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { InboxRow } from '@mpm/shared-types';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { pillFor, pillTone, previewFor, unreadBadge } from '@/lib/chat-format';
import { formatTime, istDayLabel } from '@/lib/format-date';
import { istDateKey } from '@/lib/ist-date';
import { Package, ShieldCheck } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

interface ThreadRowProps {
  row: InboxRow;
  onPress: () => void;
  /** No divider under the last row of the card. */
  last?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** "10:20 am" today, else "Yesterday" / "21 Nov 2026" (IST). */
export function rowTime(iso: string, nowMs: number = Date.now()): string {
  const ms = Date.parse(iso);
  return istDateKey(ms) === istDateKey(nowMs) ? formatTime(ms) : istDayLabel(ms, nowMs);
}

/**
 * One inbox row (mockup `.inbox .row`, §6.10): listing thumb, counterpart business with its GST badge, the listing
 * title and the last line (masked by the server), time, unread count and the pill (Your turn / Deal / status).
 */
export default function ThreadRow({ row, onPress, last, style }: ThreadRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const pill = pillFor(row);
  const unread = unreadBadge(row.unread);
  const at = row.lastMessage?.at;

  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2,
      paddingLeft: spacing.sm + 2, paddingRight: spacing.md, minHeight: 76,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    last: { borderBottomWidth: 0 },
    thumb: {
      width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    body: { flex: 1, minWidth: 0, gap: 1 },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    name: { ...type('cardTitle'), color: colors.text, flexShrink: 1 },
    title: { ...type('caption'), color: colors.textSecondary },
    preview: { ...type('caption'), color: colors.textMuted },
    previewUnread: { color: colors.text, fontFamily: fonts.semiBold },
    side: { alignItems: 'flex-end', gap: spacing.xs },
    time: { ...type('badge'), color: colors.textMuted },
    unread: {
      minWidth: 22, height: 22, borderRadius: radius.full, paddingHorizontal: 6, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    unreadText: { ...type('badge'), color: colors.onPrimary },
  }), [colors, type]);

  return (
    <Pressable
      style={[s.row, last && s.last, style]}
      onPress={onPress}
      testID={`Chats-row-${row.threadId}`}
      accessibilityRole="button"
    >
      <View style={s.thumb}>
        {row.listing.thumbUrl ? (
          <Image source={{ uri: row.listing.thumbUrl }} style={s.image} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Package size={24} color={colors.textMuted} />
        )}
      </View>
      <View style={s.body}>
        <View style={s.nameLine}>
          <Text style={s.name} numberOfLines={1}>{row.counterpart.name}</Text>
          {row.counterpart.gstVerified ? (
            <ShieldCheck size={14} color={colors.ok} accessibilityLabel={t('chats.gstVerified')} />
          ) : null}
        </View>
        <Text style={s.title} numberOfLines={1}>{row.listing.title}</Text>
        <Text style={[s.preview, unread !== null && s.previewUnread]} numberOfLines={1}>{previewFor(row, t)}</Text>
      </View>
      <View style={s.side}>
        {at ? <Text style={s.time}>{rowTime(at)}</Text> : null}
        {unread ? (
          <View style={s.unread} accessibilityLabel={t('chats.unread', { count: row.unread })}>
            <Text style={s.unreadText}>{unread}</Text>
          </View>
        ) : null}
        <StatusChip label={t(`chats.pill.${pill}`)} tone={pillTone(pill)} />
      </View>
    </Pressable>
  );
}
