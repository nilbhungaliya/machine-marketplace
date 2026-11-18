import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import type { ListingMediaItem, ListingOwnerView, MediaType } from '@mpm/shared-types';
import { LISTING_PHOTOS_MAX } from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Card from '@/components/Card';
import MediaTile from '@/components/MediaTile';
import Notice from '@/components/Notice';
import { useConfirm } from '@/components/ConfirmSheet';
import { invalidateListingLists, listingKeys } from '@/hooks/use-listing';
import { useUploadQueue } from '@/hooks/use-upload-queue';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { Camera, Check, ImagePlus, Images, Info, Video } from '@/lib/icons';
import { deleteMedia, orderMedia } from '@/lib/listing-api';
import { LISTING_ERROR_KEYS, listingErrorMessage } from '@/lib/listing-errors';
import { galleryOrder } from '@/lib/listing-format';
import { preparePhoto, prepareVideo } from '@/lib/media-device';
import { checkAdd, CAMERA_VIDEO_MAX_SECONDS, MEDIA_PROBLEM_KEYS, remainingSlots, videoUploadEnabled } from '@/lib/media-prepare';
import { tileState } from '@/lib/media-upload';
import { radius, spacing, useTheme } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';

let seq = 0;
const localId = () => `local-${Date.now()}-${++seq}`;

/**
 * Photos and video (F2 spec §5.2, §6.2–§6.5, R8, R46): the listing's media as tiles (the first photo is the cover,
 * "Make cover" moves another one first), add from the camera or the library (several at once, up to what's left),
 * every photo through the manipulator before upload, the upload queue one item at a time with progress, retry and
 * remove. Video is offered only while `videoUploadEnabled()` (off in this build: photos only). The seller stays on the
 * step while uploads run (the queue lives in this screen).
 */
export default function StepMedia({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { listing } = ctx;
  const queue = useUploadQueue(listing.id);
  const [preparing, setPreparing] = useState(0);
  const [addSheet, setAddSheet] = useState<MediaType | null>(null);
  const [tried, setTried] = useState(false);
  const video = videoUploadEnabled();

  const media = galleryOrder(listing.media);
  const photos = media.filter((m) => m.type === 'photo');
  const videos = media.filter((m) => m.type === 'video');
  const storageDown = queue.items.some((i) => i.errorCode === 'STORAGE_UNAVAILABLE');
  const photosLeft = remainingSlots('photo', photos.length, queue.pending('photo') + preparing);

  const writeMedia = (next: ListingMediaItem[]) => {
    qc.setQueryData<ListingOwnerView>(listingKeys.owner(listing.id), (prev) => (prev ? { ...prev, media: next } : prev));
    invalidateListingLists(qc, listing.id, listing.businessId);
  };

  const fail = (type: MediaType, code: string) => {
    track(LISTING_EVENTS.sellMediaUploadFailed, { type, code });
    Toast.show({ type: 'error', text1: t(LISTING_ERROR_KEYS[code] ?? 'errors.genericRetry') });
  };

  const addPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const { accepted, problem } = checkAdd('photo', assets.length, photos.length, queue.pending('photo') + preparing);
    if (problem) Toast.show({ type: 'info', text1: t(MEDIA_PROBLEM_KEYS[problem]) });
    const take = assets.slice(0, accepted);
    setPreparing((n) => n + take.length);
    for (const a of take) {
      try {
        const files = await preparePhoto(a.uri, a.width && a.height ? { width: a.width, height: a.height } : undefined);
        const thumb = files.find((f) => f.role === 'thumb') ?? files[0]!;
        queue.add([{ localId: localId(), type: 'photo', files, durationMs: null, previewUri: thumb.uri }]);
      } catch (err) {
        fail('photo', errorCode(err));
      } finally {
        setPreparing((n) => n - 1);
      }
    }
  };

  const addVideo = async (asset: ImagePicker.ImagePickerAsset) => {
    const { accepted, problem } = checkAdd('video', 1, videos.length, queue.pending('video') + preparing);
    if (problem || accepted === 0) {
      Toast.show({ type: 'info', text1: t(MEDIA_PROBLEM_KEYS[problem ?? 'videoLimit']) });
      return;
    }
    setPreparing((n) => n + 1);
    try {
      const { files, durationMs } = await prepareVideo(asset.uri, asset.duration ?? null);
      const poster = files.find((f) => f.role === 'poster') ?? files[0]!;
      queue.add([{ localId: localId(), type: 'video', files, durationMs, previewUri: poster.uri }]);
    } catch (err) {
      fail('video', errorCode(err));
    } finally {
      setPreparing((n) => n - 1);
    }
  };

  const pick = async (kind: MediaType, from: 'camera' | 'library') => {
    setAddSheet(null);
    try {
      if (from === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Toast.show({ type: 'info', text1: t('sell.media.cameraDenied') });
          return;
        }
        const result = kind === 'photo'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false })
          : await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: CAMERA_VIDEO_MAX_SECONDS });
        if (result.canceled) return;
        if (kind === 'photo') await addPhotos(result.assets);
        else if (result.assets[0]) await addVideo(result.assets[0]);
        return;
      }
      const result = kind === 'photo'
        ? await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: true, selectionLimit: Math.max(1, photosLeft),
        })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false });
      if (result.canceled) return;
      if (kind === 'photo') await addPhotos(result.assets);
      else if (result.assets[0]) await addVideo(result.assets[0]);
    } catch (err) {
      fail(kind, errorCode(err));
    }
  };

  const makeCover = async (item: ListingMediaItem) => {
    const ids = [item.id, ...listing.media.filter((m) => m.id !== item.id).map((m) => m.id)];
    try {
      writeMedia(await orderMedia(listing.id, ids));
    } catch (err) {
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    }
  };

  const remove = async (item: ListingMediaItem) => {
    const ok = await confirm({
      title: t(item.type === 'photo' ? 'sell.media.deletePhotoTitle' : 'sell.media.deleteVideoTitle'),
      confirmLabel: t('sell.media.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMedia(listing.id, item.id);
      writeMedia(listing.media.filter((m) => m.id !== item.id));
    } catch (err) {
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    }
  };

  const s = useMemo(() => StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    cell: { width: '31.5%' },
    add: {
      width: '31.5%', aspectRatio: 1, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
      backgroundColor: colors.primaryWash, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xs,
    },
    addText: { ...type('badge'), color: colors.primaryInk, textAlign: 'center' },
    disabled: { opacity: 0.5 },
    count: { ...type('caption'), color: colors.textSecondary },
    tipsTitle: { ...type('bodyStrong'), color: colors.text, marginBottom: spacing.xs },
    tip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    tipText: { ...type('body'), color: colors.textSecondary, flex: 1 },
  }), [colors, type]);

  const addTile = (kind: MediaType) => {
    const Icon = kind === 'photo' ? ImagePlus : Video;
    const disabled = kind === 'photo' ? photosLeft === 0 : remainingSlots('video', videos.length, queue.pending('video')) === 0;
    return (
      <Pressable
        key={`add-${kind}`}
        style={[s.add, disabled && s.disabled]}
        disabled={disabled}
        onPress={() => setAddSheet(kind)}
        testID={kind === 'photo' ? 'Sell-media-add-photo' : 'Sell-media-add-video'}
        accessibilityRole="button"
        accessibilityLabel={t(kind === 'photo' ? 'sell.media.addPhoto' : 'sell.media.addVideo')}
      >
        <Icon size={24} color={colors.primaryInk} />
        <Text style={s.addText}>{t(kind === 'photo' ? 'sell.media.addPhoto' : 'sell.media.addVideo')}</Text>
      </Pressable>
    );
  };

  const hasPhoto = photos.length > 0;
  return (
    <StepFrame
      ctx={ctx}
      patch={() => null}
      // Without storage (dev, R31) the server decides at publish; otherwise a listing needs a photo (§6.3).
      validate={() => {
        setTried(true);
        return hasPhoto || storageDown;
      }}
      hold={queue.busy || preparing > 0}
    >
      {storageDown ? <Notice tone="warning" icon={Info} text={t('listing.errors.storageUnavailable')} /> : null}
      <Text style={s.count}>{t('sell.media.photoCount', { count: photos.length, max: LISTING_PHOTOS_MAX })}</Text>
      <View style={s.grid}>
        {media.map((m, i) => (
          <MediaTile
            key={m.id}
            uri={m.thumbUrl ?? m.url}
            type={m.type}
            cover={m.type === 'photo' && i === 0}
            coverLabel={t('sell.media.cover')}
            onMakeCover={m.type === 'photo' && i > 0 ? () => void makeCover(m) : undefined}
            makeCoverLabel={t('sell.media.makeCover')}
            onDelete={() => void remove(m)}
            deleteLabel={t('sell.media.delete')}
            label={t(m.type === 'photo' ? 'sell.media.photoLabel' : 'sell.media.videoLabel', { index: i + 1 })}
            testID="Sell-media-tile"
            style={s.cell}
          />
        ))}
        {queue.items.map((item) => {
          const tile = tileState(item);
          return (
            <MediaTile
              key={item.localId}
              uri={item.previewUri}
              type={item.type}
              state={tile.state}
              progress={tile.progress}
              errorText={item.errorCode ? t(LISTING_ERROR_KEYS[item.errorCode] ?? 'errors.genericRetry') : undefined}
              onRetry={item.errorCode !== 'STORAGE_UNAVAILABLE' ? () => queue.retry(item.localId) : undefined}
              retryLabel={t('sell.media.retry')}
              onDelete={item.status === 'failed' ? () => queue.remove(item.localId) : undefined}
              deleteLabel={t('sell.media.delete')}
              label={t('sell.media.uploading', { percent: Math.round(tile.progress * 100) })}
              testID="Sell-media-upload"
              style={s.cell}
            />
          );
        })}
        {Array.from({ length: preparing }, (_, i) => (
          <MediaTile key={`prep-${i}`} uri={null} type="photo" state="queued" label={t('sell.media.preparing')} testID="Sell-media-preparing" style={s.cell} />
        ))}
        {addTile('photo')}
        {video ? addTile('video') : null}
      </View>
      {tried && !hasPhoto && !storageDown ? <Notice tone="danger" icon={Info} text={t('listing.errors.mediaLastPhoto')} /> : null}
      <Card>
        <Text style={s.tipsTitle}>{t('sell.media.tipsTitle')}</Text>
        {(['tipNumber', 'tipFaces', video ? 'tipVideo' : 'tipLight'] as const).map((k) => (
          <View key={k} style={s.tip}>
            <Check size={16} color={colors.ok} />
            <Text style={s.tipText}>{t(`sell.media.${k}`)}</Text>
          </View>
        ))}
      </Card>

      <ActionSheet
        visible={addSheet !== null}
        title={t(addSheet === 'video' ? 'sell.media.addVideo' : 'sell.media.addPhoto')}
        items={[
          { key: 'camera', label: t(addSheet === 'video' ? 'sell.media.recordVideo' : 'sell.media.takePhoto'), icon: Camera, testID: 'Sell-media-camera' },
          { key: 'library', label: t('sell.media.fromLibrary'), icon: Images, testID: 'Sell-media-library' },
        ]}
        onSelect={(key) => { if (addSheet) void pick(addSheet, key === 'camera' ? 'camera' : 'library'); }}
        onClose={() => setAddSheet(null)}
      />
    </StepFrame>
  );
}
