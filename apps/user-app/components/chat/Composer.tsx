import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { CHAT_LIMITS } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import IconButton from '@/components/IconButton';
import { uploadChatPhoto, useSendMessage } from '@/hooks/use-chat';
import { useType } from '@/hooks/use-type';
import { errorCode } from '@/lib/api-error';
import { acceptPhotos, messageBody, messageProblem, nextClientMessageId, photosLeft } from '@/lib/chat-composer';
import { f6ErrorKey } from '@/lib/f6-errors';
import { Camera, Images, Send, TAB_ICONS, X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface ComposerProps {
  threadId: string;
  style?: StyleProp<ViewStyle>;
}

interface PickedPhoto {
  localId: string;
  uri: string;
  width?: number;
  height?: number;
  /** The uploaded key, once uploaded (kept for a retry of the same send). */
  key: string | null;
}

/** Codes that mean the uploads are gone: drop them, so the next send uploads afresh. */
const SPENT_PHOTO_CODES = new Set(['PHOTO_INVALID', 'PHOTO_KEY_INVALID']);

/**
 * The thread's composer (mockup `.composer`, §15.1): + (photos: camera or gallery, up to 5 with the message as a
 * caption), the message (≤ 2 000), send. No mic. One `clientMessageId` per message, kept until the send succeeds, so a
 * retry after a lost reply returns the stored message instead of sending twice (§6.4).
 */
export default function Composer({ threadId, style }: ComposerProps) {
  const { t } = useTranslation();
  const { colors, shadows } = useTheme();
  const type = useType();
  const send = useSendMessage(threadId);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const clientId = useRef<string | null>(null);
  const seq = useRef(0);

  const problem = messageProblem(text, photos.length);
  const tooLong = problem === 'tooLong';

  const s = useMemo(() => StyleSheet.create({
    wrap: { marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: spacing.xs },
    bar: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, padding: spacing.xs + 1, borderRadius: radius.xl + 4,
      backgroundColor: colors.surface, ...shadows.float,
    },
    input: {
      flex: 1, minHeight: 44, maxHeight: 132, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm + 2,
      ...type('body'), color: colors.text,
    },
    dim: { opacity: 0.5 },
    photos: { gap: spacing.sm, paddingHorizontal: spacing.xs },
    photo: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.photo },
    image: { width: '100%', height: '100%' },
    remove: {
      position: 'absolute', top: 2, right: 2, width: 24, height: 24, borderRadius: radius.full, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    error: { ...type('caption'), color: colors.danger, paddingHorizontal: spacing.md },
  }), [colors, shadows, type]);

  const addAssets = (assets: ImagePicker.ImagePickerAsset[]) => {
    const { accepted, overflow } = acceptPhotos(photos.length, assets.length);
    if (overflow) Toast.show({ type: 'info', text1: t('chats.composer.photosLimit') });
    const next = assets.slice(0, accepted).map((a) => {
      seq.current += 1;
      return { localId: `p${seq.current}`, uri: a.uri, width: a.width, height: a.height, key: null };
    });
    if (next.length > 0) {
      setPhotos((prev) => [...prev, ...next]);
      // A new photo set is a new message.
      clientId.current = null;
    }
  };

  const pick = async (from: 'camera' | 'library') => {
    setSheet(false);
    try {
      if (from === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Toast.show({ type: 'info', text1: t('chats.composer.cameraDenied') });
          return;
        }
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
        if (!result.canceled) addAssets(result.assets);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: true, selectionLimit: Math.max(1, photosLeft(photos.length)),
      });
      if (!result.canceled) addAssets(result.assets);
    } catch {
      Toast.show({ type: 'error', text1: t('chats.composer.photoPrepareFailed') });
    }
  };

  const removePhoto = (localId: string) => {
    setPhotos((prev) => prev.filter((p) => p.localId !== localId));
    clientId.current = null;
  };

  const submit = async () => {
    if (busy || problem) {
      if (tooLong) Toast.show({ type: 'error', text1: t('chats.composer.tooLong') });
      return;
    }
    setBusy(true);
    const id = clientId.current ?? nextClientMessageId();
    clientId.current = id;
    try {
      const keys: string[] = [];
      for (const p of photos) {
        if (p.key) {
          keys.push(p.key);
          continue;
        }
        let key: string;
        try {
          key = await uploadChatPhoto(threadId, p.uri, p.width && p.height ? { width: p.width, height: p.height } : undefined);
        } catch (err) {
          const code = errorCode(err);
          Toast.show({
            type: 'error',
            text1: code === 'PHOTO_PREPARE_FAILED' || code === 'MEDIA_TOO_LARGE' ? t('chats.composer.photoPrepareFailed') : t('chats.composer.uploadFailed'),
          });
          return;
        }
        setPhotos((prev) => prev.map((x) => (x.localId === p.localId ? { ...x, key } : x)));
        keys.push(key);
      }
      await send.mutateAsync(messageBody(id, text, keys));
      setText('');
      setPhotos([]);
      clientId.current = null;
    } catch (err) {
      const code = errorCode(err);
      if (SPENT_PHOTO_CODES.has(code)) {
        setPhotos((prev) => prev.map((p) => ({ ...p, key: null })));
        clientId.current = null;
      }
      Toast.show({ type: 'error', text1: code === 'ERR_NETWORK' ? t('chats.composer.notSent') : t(f6ErrorKey(err)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.wrap, style]}>
      {photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photos} keyboardShouldPersistTaps="handled">
          {photos.map((p, i) => (
            <View key={p.localId} style={s.photo}>
              <Image source={{ uri: p.uri }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
              <Pressable
                style={s.remove}
                onPress={() => removePhoto(p.localId)}
                disabled={busy}
                testID={`Composer-remove-photo-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t('chats.composer.removePhoto', { n: i + 1 })}
              >
                <X size={14} color={colors.text} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {tooLong ? <Text style={s.error}>{t('chats.composer.tooLong')}</Text> : null}
      <View style={s.bar}>
        <IconButton
          icon={TAB_ICONS.post}
          variant="outline"
          onPress={() => (photosLeft(photos.length) > 0 ? setSheet(true) : Toast.show({ type: 'info', text1: t('chats.composer.photosLimit') }))}
          accessibilityLabel={t('chats.composer.addPhotos')}
          testID="Composer-add-photos"
        />
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder={t('chats.composer.placeholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={CHAT_LIMITS.messageMax + 200}
          editable={!busy}
          testID="Composer-input"
          accessibilityLabel={t('chats.composer.placeholder')}
        />
        <IconButton
          icon={Send}
          variant="primary"
          onPress={() => void submit()}
          accessibilityLabel={t('chats.composer.send')}
          testID="Composer-send"
          style={busy || problem !== null ? s.dim : undefined}
        />
      </View>
      <ActionSheet
        visible={sheet}
        title={t('chats.composer.photosTitle')}
        items={[
          { key: 'camera', label: t('chats.composer.takePhoto'), icon: Camera, testID: 'Composer-photo-camera' },
          { key: 'library', label: t('chats.composer.chooseGallery'), icon: Images, testID: 'Composer-photo-gallery' },
        ]}
        onSelect={(key) => void pick(key as 'camera' | 'library')}
        onClose={() => setSheet(false)}
      />
    </View>
  );
}
