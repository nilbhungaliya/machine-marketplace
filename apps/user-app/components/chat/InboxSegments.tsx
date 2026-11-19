import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { InboxFilter } from '@mpm/shared-types';
import SegmentedControl from '@/components/SegmentedControl';

interface InboxSegmentsProps {
  value: InboxFilter;
  onChange: (filter: InboxFilter) => void;
  /** `counts.yourTurn` of the list (§6.10: "Your turn 3"). */
  yourTurn: number;
  style?: StyleProp<ViewStyle>;
}

/** The Chats tab's segments (mockup negotiate · "Enquiries inbox"): All / Buying / Selling / Your turn n. */
export default function InboxSegments({ value, onChange, yourTurn, style }: InboxSegmentsProps) {
  const { t } = useTranslation();
  return (
    <SegmentedControl<InboxFilter>
      value={value}
      onChange={onChange}
      accessibilityLabel={t('chats.segments.label')}
      style={style}
      options={[
        { value: 'all', label: t('chats.segments.all'), testID: 'Chats-filter-all' },
        { value: 'buying', label: t('chats.segments.buying'), testID: 'Chats-filter-buying' },
        { value: 'selling', label: t('chats.segments.selling'), testID: 'Chats-filter-selling' },
        {
          value: 'your_turn',
          label: yourTurn > 0 ? t('chats.segments.yourTurnCount', { count: yourTurn }) : t('chats.segments.yourTurn'),
          testID: 'Chats-filter-your-turn',
        },
      ]}
    />
  );
}
