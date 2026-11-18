import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Builds on app.json (passed in as `config`). The Google Maps key for Android is added only when
 * EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY is set; `extra.mapsEnabled` tells the app whether to draw the map on
 * Where are you? (F1 spec §4.2). Without a key the screen works with the pincode and the location button.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?.trim() ?? '';
  const mapsEnabled = mapsKey !== '';
  return {
    ...config,
    name: config.name ?? 'Machine Parts',
    slug: config.slug ?? 'machine-parts-user-app',
    android: {
      ...config.android,
      ...(mapsEnabled ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } } : {}),
    },
    extra: { ...config.extra, mapsEnabled },
  };
};
