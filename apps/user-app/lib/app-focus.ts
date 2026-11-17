import type { AppStateStatus } from 'react-native';

/** Only 'active' counts as focused; 'inactive' is iOS's transitional state. */
export function isFocusedState(status: AppStateStatus): boolean {
  return status === 'active';
}
