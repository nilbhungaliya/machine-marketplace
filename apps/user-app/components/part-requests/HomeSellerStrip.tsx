import type { StyleProp, ViewStyle } from 'react-native';
import type { PartRequestHome } from '@mpm/shared-types';

export interface HomeSellerStripProps {
  data: NonNullable<PartRequestHome['seller']>;
  style?: StyleProp<ViewStyle>;
}

// F8-STUB(B3): Home's seller strip (F8 spec §13.4); renders nothing until lane B3 builds it.
export default function HomeSellerStrip(_props: HomeSellerStripProps) {
  return null;
}
