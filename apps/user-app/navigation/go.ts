import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppTarget } from '@/lib/gst-flow';
import type { RootStackParamList } from './types';

// Opening a screen chosen at run time (`gstScreen`, `profileRowTarget`): React Navigation's typed `navigate` can't
// take a union of targets, so the cast lives here, once.

/** Any root-stack screen's navigation (only these methods, which don't depend on the screen). */
type Nav = Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate' | 'replace' | 'reset' | 'getState'>;
export type StackTarget = AppTarget | { screen: 'Main' } | { screen: 'Profile' };
type Go = (name: string, params?: object) => void;

const paramsOf = (t: StackTarget): object | undefined => ('params' in t ? t.params : undefined);

export function openTarget(navigation: Nav, target: StackTarget, how: 'navigate' | 'replace' = 'navigate'): void {
  const go = (how === 'replace' ? navigation.replace : navigation.navigate) as unknown as Go;
  go.call(navigation, target.screen, paramsOf(target));
}

/** Replaces the whole stack with `targets` (the last one on top). */
export function resetTo(navigation: Nav, targets: StackTarget[]): void {
  navigation.reset({
    index: targets.length - 1,
    routes: targets.map((t) => ({ name: t.screen, params: paramsOf(t) })) as never,
  });
}

/** Ends a GST flow on `target`, with Profile underneath when the flow was opened from it. */
export function finishGstFlow(navigation: Nav, target: StackTarget): void {
  const fromProfile = navigation.getState().routes.some((r) => r.name === 'Profile');
  resetTo(navigation, fromProfile ? [{ screen: 'Main' }, { screen: 'Profile' }, target] : [{ screen: 'Main' }, target]);
}
