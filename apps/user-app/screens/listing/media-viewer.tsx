import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import type { ListingMediaItem } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import IconButton from '@/components/IconButton';
import EmptyState from '@/components/EmptyState';
import { useListing } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { Package, Play, X } from '@/lib/icons';
import { galleryOrder } from '@/lib/listing-format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** A video page: the player exists only while the page is on screen, so swiping away stops it. */
function VideoPage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={{ width, height }} nativeControls contentFit="contain" />;
}

/**
 * The full-screen viewer of a listing's media (F2 spec §8.1 item 1), opened at `index` of `galleryOrder` (the order the
 * listing page's pager uses): photos, and videos playing with `expo-video`. Video upload is off for now (amendment 3),
 * so a video appears only on a listing that already has one.
 */
export default function MediaViewerScreen({ navigation, route }: RootStackScreenProps<'ListingMedia'>) {
  const { listingId, index } = route.params;
  const { t } = useTranslation();
  const { colors, shadows } = useTheme();
  const type = useType();
  const { width, height } = useWindowDimensions();
  const listing = useListing(listingId);
  const media = useMemo(() => galleryOrder(listing.data?.media ?? []), [listing.data?.media]);
  const start = Math.min(Math.max(0, index), Math.max(0, media.length - 1));
  const [page, setPage] = useState(start);

  useEffect(() => setPage(start), [start]);

  const s = useMemo(() => StyleSheet.create({
    top: {
      position: 'absolute', top: spacing.sm, left: spacing.lg, right: spacing.lg, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'space-between',
    },
    counter: {
      ...type('badge'), color: colors.text, backgroundColor: colors.surface, borderRadius: radius.full,
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs, overflow: 'hidden', ...shadows.raised,
    },
    page: { alignItems: 'center', justifyContent: 'center' },
    image: { width: '100%', height: '100%' },
    playWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    play: {
      width: 64, height: 64, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center', ...shadows.raised,
    },
  }), [colors, shadows, type]);

  const pageHeight = height - spacing.xxxl * 2;

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  };

  const renderItem = ({ item, index: i }: { item: ListingMediaItem; index: number }) => {
    const active = i === page;
    if (item.type === 'video' && item.url && active) {
      return <View style={[s.page, { width, height: pageHeight }]}><VideoPage uri={item.url} width={width} height={pageHeight} /></View>;
    }
    const uri = item.type === 'photo' ? item.url ?? item.thumbUrl : item.thumbUrl;
    return (
      <View style={[s.page, { width, height: pageHeight }]} testID={`Media-viewer-${i}`}>
        {uri ? (
          <Image source={{ uri }} style={s.image} contentFit="contain" transition={150} accessibilityIgnoresInvertColors />
        ) : (
          <Package size={56} color={colors.textMuted} />
        )}
        {item.type === 'video' ? (
          <View style={s.playWrap} pointerEvents="none">
            <View style={s.play}><Play size={28} color={colors.primaryInk} fill={colors.primaryInk} /></View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ScreenWrapper>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {media.length === 0 ? (
          listing.isLoading ? null : <EmptyState icon={Package} title={t('listing.view.noPhoto')} subtitle={listing.data?.title ?? ''} />
        ) : (
          <FlatList
            data={media}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            extraData={page}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={start}
            getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onScrollEnd}
          />
        )}
        <View style={s.top} pointerEvents="box-none">
          <IconButton icon={X} onPress={() => navigation.goBack()} accessibilityLabel={t('listing.viewer.close')} testID="Media-viewer-close" />
          {media.length > 1 ? (
            <Text style={s.counter}>{t('listing.view.mediaCounter', { index: Math.min(page, media.length - 1) + 1, total: media.length })}</Text>
          ) : null}
        </View>
      </View>
    </ScreenWrapper>
  );
}
