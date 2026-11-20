import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { PART_REQUEST_LIMITS } from '@mpm/shared-types';
import Button from '@/components/Button';
import Field from '@/components/Field';
import IconButton from '@/components/IconButton';
import { errorCode } from '@/lib/api-error';
import { f8ErrorMessage } from '@/lib/f8-errors';
import { Camera, Images, Package, X } from '@/lib/icons';
import { preparePhoto, putFile } from '@/lib/media-device';
import type { FormPhoto } from '@/lib/part-request-form';
import { presignPartRequestPhoto } from '@/lib/part-requests-api';
import { radius, spacing, useTheme } from '@/lib/theme';

/** One picked photo → re-encoded on the phone (≤ 1 600 px JPEG, no EXIF / GPS) → presigned → PUT; returns its key. */
async function uploadRequestPhoto(uri: string, size?: { width: number; height: number }): Promise<string> {
  const [full] = await preparePhoto(uri, size);
  if (!full) throw Object.assign(new Error('PHOTO_PREPARE_FAILED'), { code: 'PHOTO_PREPARE_FAILED' });
  const signed = await presignPartRequestPhoto(full.contentType, full.size);
  await putFile(signed.url, full, () => {});
  return signed.key;
}

/**
 * Reference photos of a requirement (F8 spec R1, §17): up to 3, private, uploaded at once through chat's pipeline
 * (presign → PUT to `incoming-chat/`; the server re-encodes them when the request is saved). Stored photos of an edit
 * show their signed URLs (`urls`, by key) or a placeholder while they load.
 */
export default function PhotoPicker({ photos, urls, onChange, error, style }: {
  photos: FormPhoto[];
  /** Signed URLs of the request's stored photos, by key (edit). */
  urls?: Record<string, string>;
  onChange: (next: FormPhoto[]) => void;
  error?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const left = PART_REQUEST_LIMITS.photosMax - photos.length;

  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' },
    tile: {
      width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    remove: { position: 'absolute', top: -spacing.sm, right: -spacing.sm },
    actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  }), [colors]);

  const add = async (from: 'camera' | 'library') => {
    if (left <= 0 || busy) return;
    let assets: ImagePicker.ImagePickerAsset[] = [];
    try {
      if (from === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Toast.show({ type: 'info', text1: t('requirements.form.photos.cameraDenied') });
          return;
        }
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
        if (!r.canceled) assets = r.assets;
      } else {
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: true, selectionLimit: left,
        });
        if (!r.canceled) assets = r.assets;
      }
    } catch {
      Toast.show({ type: 'error', text1: t('requirements.form.photos.pickFailed') });
      return;
    }
    if (assets.length === 0) return;
    setBusy(true);
    let next = photos;
    try {
      for (const a of assets.slice(0, left)) {
        const key = await uploadRequestPhoto(a.uri, a.width && a.height ? { width: a.width, height: a.height } : undefined);
        next = [...next, { key, uri: a.uri }];
        onChange(next);
      }
    } catch (err) {
      const code = errorCode(err);
      Toast.show({
        type: 'error',
        text1: code === 'PHOTO_PREPARE_FAILED' || code === 'MEDIA_TOO_LARGE' ? t('requirements.form.photos.prepareFailed') : f8ErrorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label={t('requirements.form.photos.label')} hint={t('requirements.form.photos.hint', { max: PART_REQUEST_LIMITS.photosMax })} error={error} style={style}>
      <View style={s.row}>
        {photos.map((p, i) => {
          const uri = p.uri ?? urls?.[p.key] ?? null;
          return (
            <View key={p.key}>
              <View style={s.tile}>
                {uri ? (
                  <Image source={{ uri }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
                ) : (
                  <Package size={24} color={colors.textMuted} />
                )}
              </View>
              <IconButton
                icon={X}
                iconSize={16}
                onPress={() => onChange(photos.filter((x) => x.key !== p.key))}
                accessibilityLabel={t('requirements.form.photos.remove', { n: i + 1 })}
                testID="Request-photo-remove"
                style={s.remove}
              />
            </View>
          );
        })}
        {busy ? <View style={s.tile}><ActivityIndicator color={colors.primary} /></View> : null}
      </View>
      {left > 0 && !busy ? (
        <View style={s.actions}>
          <Button title={t('requirements.form.photos.camera')} onPress={() => void add('camera')} variant="outline" size="sm" icon={Camera} phLabel="Request-photo-camera" />
          <Button title={t('requirements.form.photos.library')} onPress={() => void add('library')} variant="outline" size="sm" icon={Images} phLabel="Request-photo-library" />
        </View>
      ) : null}
    </Field>
  );
}
