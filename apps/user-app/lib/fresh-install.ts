import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Set once per install, in storage that dies with the app container.
 *
 * AsyncStorage lives under the app's Library directory on iOS and in
 * /data/data on Android, so deleting the app deletes it. That is exactly the
 * property the keychain lacks, which is what makes it usable as the marker.
 */
const INSTALL_MARKER_KEY = 'install_marker';

/** Every SecureStore key that must not outlive the install that wrote it. */
const SECURE_KEYS = ['jwt_token'];

/**
 * Wipe session keys the iOS keychain carried across an uninstall.
 *
 * Deleting an app does not clear its keychain items — they are scoped to the
 * bundle id, not the container, so a reinstall of the same build inherits
 * them. `expo-secure-store` stores the JWT as a generic-password item, and our
 * user JWTs are signed for 30 days, so a reinstall would read a still-valid
 * token and open straight to the home screen signed in as whoever last used
 * the handset. Android is unaffected (expo-secure-store excludes its prefs
 * from Auto Backup), but the marker costs nothing there and keeps one code
 * path.
 *
 * Must run before anything reads the token. Returns whether it purged.
 */
export async function clearKeychainOnFreshInstall(): Promise<boolean> {
  let marker: string | null = null;
  try {
    marker = await AsyncStorage.getItem(INSTALL_MARKER_KEY);
  } catch {
    // An unreadable marker is treated as present: signing a working install
    // out over a transient storage error is worse than missing one purge.
    return false;
  }
  if (marker) return false;

  for (const key of SECURE_KEYS) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Nothing stored under that key, or an entry we cannot read anyway.
    }
  }

  try {
    await AsyncStorage.setItem(INSTALL_MARKER_KEY, '1');
  } catch {
    // Purge already happened, which is the part that matters. Without the
    // marker the next cold start purges again — an unnecessary sign-out, but
    // only if the write keeps failing, and never a session left behind.
  }
  return true;
}
