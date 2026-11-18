import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

interface SideDiagramProps {
  /** Which marker is filled (violet): the side the seller picked; both outlined when null. */
  highlight?: 'left' | 'right' | null;
  /** Translated caption title ("Seen from behind, facing forward") and text; omit for the drawing alone. */
  title?: string;
  text?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The side convention drawing (v2 `sideDiagram()`, F2 spec §5.2 side step, R38b): a machine seen from above with the
 * operator behind it, L and R markers. Draw it **only for the default convention** (`DEFAULT_SIDE_CONVENTION`): a
 * custom convention text may describe another viewpoint, so the caller decides.
 */
export default function SideDiagram({ highlight = 'left', title, text, style }: SideDiagramProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    box: {
      alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md,
      borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    },
    title: { ...type('label'), color: colors.text, textAlign: 'center' },
    text: { ...type('caption'), color: colors.textSecondary, textAlign: 'center' },
  }), [colors, type]);

  const marker = (side: 'left' | 'right') => {
    const on = highlight === side;
    return { fill: on ? colors.primary : colors.field, ink: on ? colors.onPrimary : colors.textMuted };
  };
  const l = marker('left');
  const r = marker('right');

  return (
    <View style={[s.box, style]} accessibilityElementsHidden={!title} importantForAccessibility={title ? 'auto' : 'no-hide-descendants'}>
      <Svg width={172} height={110} viewBox="0 0 120 86">
        {/* Forward arrow (the machine's front). */}
        <Path d="M60 2l7 9h-4v7h-6v-7h-4z" fill={colors.textMuted} />
        {/* Machine body, left half tinted. */}
        <Rect x={38} y={22} width={44} height={46} rx={9} fill={colors.photo} stroke={colors.border} />
        <Rect x={38} y={22} width={22} height={46} rx={9} fill={colors.primarySoft} />
        {/* Wheels. */}
        <Rect x={28} y={24} width={9} height={15} rx={3} fill={colors.textSecondary} />
        <Rect x={83} y={24} width={9} height={15} rx={3} fill={colors.textSecondary} />
        <Rect x={25} y={46} width={12} height={20} rx={3} fill={colors.textSecondary} />
        <Rect x={83} y={46} width={12} height={20} rx={3} fill={colors.textSecondary} />
        {/* L / R markers. */}
        <Circle cx={12} cy={45} r={9} fill={l.fill} />
        <SvgText x={12} y={49} textAnchor="middle" fontSize={11} fontFamily={fonts.extraBold} fill={l.ink}>L</SvgText>
        <Circle cx={108} cy={45} r={9} fill={r.fill} />
        <SvgText x={108} y={49} textAnchor="middle" fontSize={11} fontFamily={fonts.extraBold} fill={r.ink}>R</SvgText>
        {/* The operator, behind the machine. */}
        <Circle cx={60} cy={79} r={4} fill={colors.text} />
        <Path d="M53 86c1-4 4-5.5 7-5.5s6 1.5 7 5.5" fill={colors.text} />
      </Svg>
      {title ? <Text style={s.title}>{title}</Text> : null}
      {text ? <Text style={s.text}>{text}</Text> : null}
    </View>
  );
}
