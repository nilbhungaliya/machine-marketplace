import fs from 'fs';
import path from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Builds on app.json (passed in as `config`). The Google Maps key for Android is added only when
 * EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY is set; `extra.mapsEnabled` tells the app whether to draw the map on
 * Where are you? (F1 spec §4.2). Without a key the screen works with the pincode and the location button.
 *
 * Push (F6 + F7 spec §11.5, Android): `android.googleServicesFile` is set only when a Firebase `google-services.json`
 * exists (`GOOGLE_SERVICES_JSON`, a path, or `./google-services.json` next to this file; never committed). Without it
 * the build has no FCM: the app builds and runs, and push registration fails quietly (`lib/push.ts`). The
 * `expo-notifications` plugin names the `default` channel as FCM's default (the one `lib/push.ts` creates and the
 * API sends to). Adding the plugin needs a new dev-client build (`pnpm android`).
 */
function googleServicesFile(): string | null {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON?.trim();
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null;
  return fs.existsSync(path.join(__dirname, 'google-services.json')) ? './google-services.json' : null;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?.trim() ?? '';
  const mapsEnabled = mapsKey !== '';
  const firebase = googleServicesFile();
  return {
    ...config,
    name: config.name ?? 'Machine Parts',
    slug: config.slug ?? 'machine-parts-user-app',
    android: {
      ...config.android,
      ...(mapsEnabled ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } } : {}),
      ...(firebase ? { googleServicesFile: firebase } : {}),
    },
    plugins: [...(config.plugins ?? []), ['expo-notifications', { defaultChannel: 'default' }]],
    extra: { ...config.extra, mapsEnabled },
  };
};
