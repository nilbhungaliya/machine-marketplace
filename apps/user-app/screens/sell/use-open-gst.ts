import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { gstStateQuery } from '@/hooks/use-business';
import { gstScreen } from '@/lib/gst-flow';
import { listingErrorMessage } from '@/lib/listing-errors';
import { queryClient } from '@/lib/queryClient';
import { openTarget } from '@/navigation/go';
import type { RootStackParamList } from '@/navigation/types';

/**
 * "Verify GST" from the sell flow (F2 spec §5.1; plan Task 23): fetches the GST state and opens `gstScreen(state)`
 * (the Post tab's rental card, Preview's `UNVERIFIED_LISTING_CAP` / `RENTAL_NEEDS_GST`).
 */
export function useOpenGst() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      const state = await queryClient.fetchQuery(gstStateQuery);
      openTarget(navigation, gstScreen(state));
    } catch (err) {
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    } finally {
      setOpening(false);
    }
  };
  return { open, opening };
}
