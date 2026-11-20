import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { RENTAL_LIMITS } from '@mpm/shared-types';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { uploadBookingPhoto } from '@/hooks/use-rental-calendar';
import { useType } from '@/hooks/use-type';
import { errorCode } from '@/lib/api-error';
import { i18n } from '@/lib/i18n';
import { Camera, Images, X } from '@/lib/icons';
import { M14_ERROR_KEYS } from '@/lib/m14-errors';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * A failed step-photo upload: the server's own copy for a refusal it explains (too many photos, a viewer, storage
 * down…), else "Couldn't upload the photo" (the picture couldn't be prepared, or the upload failed).
 */
export function photoUploadMessage(err: unknown): string {
  const known = M14_ERROR_KEYS[errorCode(err)];
  return i18n.t(known ?? 'rentalsOwner.photos.uploadFailed');
}

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/**
 * The step photos' state (on site, return; ≤ 3, private): what was picked, and `upload()` which sends the ones not yet
 * sent and returns every key. A key is kept per picture, so a retried tap re-sends the same keys with the same
 * idempotency key.
 */
export function useStepPhotos(bookingId: string) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const keys = useRef(new Map<string, string>());
  const [uploading, setUploading] = useState(false);

  const reset = useCallback(() => {
    setPhotos([]);
    keys.current.clear();
  }, []);

  /** Uploads the photos still without a key; throws the first failure. */
  const upload = useCallback(async (): Promise<string[]> => {
    setUploading(true);
    try {
      const out: string[] = [];
      for (const p of photos) {
        let key = keys.current.get(p.uri);
        if (!key) {
          key = await uploadBookingPhoto(bookingId, p.uri, { width: p.width, height: p.height });
          keys.current.set(p.uri, key);
        }
        out.push(key);
      }
      return out;
    } finally {
      setUploading(false);
    }
  }, [bookingId, photos]);

  return { photos, setPhotos, reset, upload, uploading };
}

interface StepPhotosProps {
  photos: PickedPhoto[];
  onChange: (photos: PickedPhoto[]) => void;
  /** Prefix of the row's `testID`s (`OnSite`, `Return`). */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** Up to three photos from the camera or the library, with remove buttons (the F6 hand-over photo row, × 3). */
export default function StepPhotos({ photos, onChange, testID: idPrefix, style }: StepPhotosProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    wrap: { gap: spacing.sm },
    label: { ...type('label'), color: colors.text },
    hint: { ...type('caption'), color: colors.textSecondary },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' },
    preview: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.photo },
    remove: { position: 'absolute', top: -spacing.sm, right: -spacing.sm },
  }), [colors, type]);

  const full = photos.length >= RENTAL_LIMITS.photosMax;

  const pick = async (from: 'camera' | 'library') => {
    try {
      if (from === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Toast.show({ type: 'error', text1: t('deals.photos.cameraDenied') });
          return;
        }
      }
      const result = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: false });
      if (result.canceled || !result.assets[0]) return;
      const a = result.assets[0];
      onChange([...photos, { uri: a.uri, width: a.width, height: a.height }].slice(0, RENTAL_LIMITS.photosMax));
    } catch {
      Toast.show({ type: 'error', text1: t('deals.photos.pickFailed') });
    }
  };

  return (
    <View style={[s.wrap, style]}>
      <Text style={s.label}>{t('rentalsOwner.photos.label')}</Text>
      <Text style={s.hint}>{t('rentalsOwner.photos.hint', { max: RENTAL_LIMITS.photosMax })}</Text>
      <View style={s.row}>
        {photos.map((p, i) => (
          <View key={p.uri}>
            <Image source={{ uri: p.uri }} style={s.preview} contentFit="cover" accessibilityIgnoresInvertColors />
            <IconButton
              icon={X}
              onPress={() => onChange(photos.filter((x) => x.uri !== p.uri))}
              accessibilityLabel={t('deals.photos.remove')}
              testID={`${idPrefix}-photo-remove-${i}`}
              iconSize={16}
              style={s.remove}
            />
          </View>
        ))}
        {full ? null : (
          <>
            <Button title={t('deals.photos.camera')} onPress={() => void pick('camera')} variant="outline" size="sm" icon={Camera} phLabel={`${idPrefix}-camera`} />
            <Button title={t('deals.photos.library')} onPress={() => void pick('library')} variant="outline" size="sm" icon={Images} phLabel={`${idPrefix}-library`} />
          </>
        )}
      </View>
    </View>
  );
}
