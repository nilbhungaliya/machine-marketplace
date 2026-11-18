import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SIDE_CONVENTION, type PartSide } from '@mpm/shared-types';
import { FieldError } from '@/components/Field';
import Notice from '@/components/Notice';
import SideDiagram from '@/components/SideDiagram';
import SideToken from '@/components/SideToken';
import { useType } from '@/hooks/use-type';
import { Info } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';

/**
 * The sides a seller can pick on a part group with sides (F2 spec §5.2 side step). "No side" isn't offered: on a node
 * with sides the API needs left, right or pair to publish (`SIDE_REQUIRED`), so it could only lead to a dead end.
 */
const OPTIONS = ['left', 'right', 'pair'] as const satisfies readonly PartSide[];

/**
 * Step 5 for parts with sides, Which side? (F2 spec §5.2, F3): big SideToken choices, the node's side convention, the
 * diagram only for the default convention (R38b), and how matching uses the side.
 */
export default function StepSide({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { listing, node } = ctx;
  const [side, setSide] = useState<PartSide | null>(listing.side === 'not_applicable' ? null : listing.side);
  const [tried, setTried] = useState(false);
  // Compared with the side at mount, not the live owner view, so a saved step stays clean.
  const [initial] = useState(listing.side);
  const convention = node?.effectiveSideConvention ?? DEFAULT_SIDE_CONVENTION;

  const s = useMemo(() => StyleSheet.create({
    title: { ...type('title'), color: colors.text },
    convention: { ...type('body'), color: colors.textSecondary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    option: {
      flexGrow: 1, flexBasis: '45%', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm,
      borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface,
    },
    on: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
    label: { ...type('bodyStrong'), color: colors.text, textAlign: 'center' },
  }), [colors, type]);

  const matchText = side === 'left' ? t('sell.side.matchLeft') : side === 'right' ? t('sell.side.matchRight') : side === 'pair' ? t('sell.side.matchPair') : t('sell.side.matchLeft');

  return (
    <StepFrame
      ctx={ctx}
      patch={() => (side && side !== initial ? { side } : null)}
      validate={() => {
        setTried(true);
        return side !== null;
      }}
    >
      <Text style={s.title}>{t('sell.side.title')}</Text>
      <Text style={s.convention}>{convention}</Text>
      {convention === DEFAULT_SIDE_CONVENTION ? (
        <SideDiagram highlight={side === 'left' || side === 'right' ? side : null} title={t('sell.side.diagramTitle')} text={t('sell.side.diagramText')} />
      ) : null}
      <View style={s.grid} accessibilityRole="radiogroup">
        {OPTIONS.map((k) => (
          <Pressable
            key={k}
            style={[s.option, side === k && s.on]}
            onPress={() => setSide(k)}
            testID={`Sell-side-${k}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: side === k }}
          >
            <SideToken kind={k} size="xl" />
            <Text style={s.label}>{t(`sell.side.option.${k}`)}</Text>
          </Pressable>
        ))}
      </View>
      {tried && !side ? <FieldError>{t('listing.errors.sideRequired')}</FieldError> : null}
      {listing.reviewOnEdit ? <Notice tone="warning" icon={Info} text={t('sell.reviewOnEdit')} /> : null}
      <Notice tone="info" icon={Info} text={matchText} />
    </StepFrame>
  );
}
