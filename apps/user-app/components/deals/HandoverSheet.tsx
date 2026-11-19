import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { DEAL_LIMITS } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Input from '@/components/Input';
import { uploadDealPhoto, useDealWrite } from '@/hooks/use-deals';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { DEAL_EVENTS } from '@/lib/analytics-events';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { Camera, Images, X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface HandoverSheetProps {
  dealId: string;
  buyerName: string;
  visible: boolean;
  onClose: () => void;
}

type Picked = { uri: string; width: number; height: number };

/**
 * Mark handed over (§9.2, mockup deals · "Handed over"): an optional photo (private, §6.8) and note (≤ 300). The buyer
 * then has the report window, and the deal completes on its own after the auto-complete time. An uploaded photo's key
 * is kept for a retried tap, so the same idempotency key replays the same request.
 */
export default function HandoverSheet({ dealId, buyerName, visible, onClose }: HandoverSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const write = useDealWrite(dealId);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [uploaded, setUploaded] = useState<{ uri: string; key: string } | null>(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPhoto(null);
    setUploaded(null);
    setNote('');
  }, [visible]);

  const s = useMemo(() => StyleSheet.create({
    body: { ...type('body'), color: colors.textSecondary },
    photoRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    preview: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.photo },
    remove: { position: 'absolute', top: -spacing.sm, right: -spacing.sm },
  }), [colors, type]);

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
      setPhoto({ uri: a.uri, width: a.width, height: a.height });
    } catch {
      Toast.show({ type: 'error', text1: t('deals.photos.pickFailed') });
    }
  };

  const tooLong = [...note.trim()].length > DEAL_LIMITS.handoverNoteMax;

  const submit = async () => {
    if (tooLong) return;
    let photoKey: string | undefined;
    if (photo) {
      if (uploaded && uploaded.uri === photo.uri) photoKey = uploaded.key;
      else {
        setUploading(true);
        try {
          photoKey = await uploadDealPhoto(dealId, photo.uri, { width: photo.width, height: photo.height });
          setUploaded({ uri: photo.uri, key: photoKey });
        } catch (err) {
          Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
          return;
        } finally {
          setUploading(false);
        }
      }
    }
    const trimmed = note.trim();
    write.mutate({ action: 'hand_over', body: { ...(photoKey ? { photoKey } : {}), note: trimmed === '' ? null : trimmed } }, {
      onSuccess: () => {
        track(DEAL_EVENTS.handedOver, { withPhoto: !!photoKey });
        Toast.show({ type: 'success', text1: t('deals.handover.done') });
        onClose();
      },
      onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('deals.handover.title')} testID="Deal-handover-backdrop">
      <Text style={s.body}>{t('deals.handover.body', { name: buyerName })}</Text>
      <View style={s.photoRow}>
        {photo ? (
          <View>
            <Image source={{ uri: photo.uri }} style={s.preview} contentFit="cover" accessibilityIgnoresInvertColors />
            <IconButton
              icon={X}
              onPress={() => setPhoto(null)}
              accessibilityLabel={t('deals.photos.remove')}
              testID="Deal-handover-photo-remove"
              iconSize={16}
              style={s.remove}
            />
          </View>
        ) : (
          <>
            <Button title={t('deals.photos.camera')} onPress={() => void pick('camera')} variant="outline" size="sm" icon={Camera} phLabel="Deal-handover-camera" />
            <Button title={t('deals.photos.library')} onPress={() => void pick('library')} variant="outline" size="sm" icon={Images} phLabel="Deal-handover-library" />
          </>
        )}
      </View>
      <Input
        label={t('deals.handover.note')}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder={t('offers.sheet.noteHint')}
        error={tooLong ? t('deals.handover.noteError', { max: DEAL_LIMITS.handoverNoteMax }) : undefined}
        testID="Deal-handover-note"
      />
      <Button
        title={t('deals.actions.hand_over')}
        onPress={() => void submit()}
        loading={uploading || write.isPending}
        phLabel="Deal-handover-confirm"
      />
    </BottomSheet>
  );
}
