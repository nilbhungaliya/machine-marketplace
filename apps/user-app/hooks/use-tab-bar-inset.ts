import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabBarInset } from '@/lib/tab-bar';

/** Bottom padding for a tab screen's content, so nothing sits under the floating tab bar (spec §7.5). */
export function useTabBarInset(): number {
  return tabBarInset(useSafeAreaInsets().bottom);
}
