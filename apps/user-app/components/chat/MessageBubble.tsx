import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ThreadMessage } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { formatTime } from '@/lib/format-date';
import { radius, spacing, useTheme } from '@/lib/theme';
import PhotoGrid from './PhotoGrid';

interface MessageBubbleProps {
  message: ThreadMessage;
  onPhotoExpired?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A text or photos message (mockup `.msg`, `.msg.me`, `.msg.media`): mine on the right in violet, theirs on the left on
 * white with a hairline. The text is shown exactly as the API sent it for this reader (masked until the reveal, §6.5):
 * the app never rebuilds or unmasks it.
 */
export default function MessageBubble({ message, onPhotoExpired, style }: MessageBubbleProps) {
  const { colors } = useTheme();
  const type = useType();
  const mine = message.isMine;

  const s = useMemo(() => StyleSheet.create({
    bubble: {
      maxWidth: '82%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs,
      borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    },
    theirs: {
      alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
      borderBottomRightRadius: radius.lg, borderBottomLeftRadius: 5,
    },
    mine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: 5 },
    text: { ...type('body'), color: colors.text },
    textMine: { color: colors.onPrimary },
    time: { ...type('caption'), color: colors.textMuted, alignSelf: 'flex-end' },
    timeMine: { color: colors.primarySoft },
  }), [colors, type]);

  return (
    <View style={[s.bubble, mine ? s.mine : s.theirs, style]} testID={`Thread-message-${message.seq}`}>
      {message.photos.length > 0 ? <PhotoGrid photos={message.photos} messageId={message.id} onExpired={onPhotoExpired} /> : null}
      {message.text ? <Text style={[s.text, mine && s.textMine]} selectable>{message.text}</Text> : null}
      <Text style={[s.time, mine && s.timeMine]}>{formatTime(Date.parse(message.createdAt))}</Text>
    </View>
  );
}
