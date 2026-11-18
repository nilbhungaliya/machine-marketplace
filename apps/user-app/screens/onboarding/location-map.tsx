import React, { useEffect, useRef } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

export interface Pin {
  lat: number;
  lng: number;
}

const ZOOM = { latitudeDelta: 0.01, longitudeDelta: 0.01 };

/**
 * The business's pin on a map (F1 spec §4.2). Only rendered when the build has a Google Maps key
 * (`extra.mapsEnabled`, app.config.ts): on Android, MapView without one crashes. Drag the pin or tap the map to move it.
 */
export default function LocationMap({ pin, onChange, style }: { pin: Pin; onChange: (pin: Pin) => void; style?: StyleProp<ViewStyle> }) {
  const map = useRef<MapView>(null);

  useEffect(() => {
    map.current?.animateToRegion({ latitude: pin.lat, longitude: pin.lng, ...ZOOM }, 300);
  }, [pin.lat, pin.lng]);

  return (
    <MapView
      ref={map}
      style={style}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={{ latitude: pin.lat, longitude: pin.lng, ...ZOOM }}
      onPress={(e) => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
      toolbarEnabled={false}
    >
      <Marker
        draggable
        coordinate={{ latitude: pin.lat, longitude: pin.lng }}
        onDragEnd={(e) => onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
      />
    </MapView>
  );
}
