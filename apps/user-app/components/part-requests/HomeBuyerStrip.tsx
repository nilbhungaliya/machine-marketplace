import type { StyleProp, ViewStyle } from 'react-native';
import type { PartRequestHome } from '@mpm/shared-types';

export interface HomeBuyerStripProps {
  data: NonNullable<PartRequestHome['buyer']>;
  style?: StyleProp<ViewStyle>;
}

// F8-STUB(B2): Home's buyer strip (F8 spec §13.4); renders nothing until lane B2 builds it.
export default function HomeBuyerStrip(_props: HomeBuyerStripProps) {
  return null;
}
