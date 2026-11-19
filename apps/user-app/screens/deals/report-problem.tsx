import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { DEAL_LIMITS, DISPUTE_CATEGORIES, type DisputeCategory } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import FooterBar from '@/components/FooterBar';
import IconButton from '@/components/IconButton';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import { uploadDealPhoto, useDealWrite } from '@/hooks/use-deals';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { DEAL_EVENTS } from '@/lib/analytics-events';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { ImagePlus, Info, X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

type Picked = { uri: string; width: number; height: number };

/**
 * Report a problem with a handed-over deal (F6 + F7 spec §9.6; no mockup, built in the mockup's language): a category,
 * a description (10–1 000, masked to the other side) and up to 5 private photos. The deal goes to support (`disputed`)
 * and its timers stop. Uploaded photo keys are kept per photo, so a retried tap sends the same request.
 */
export default function ReportProblemScreen({ navigation, route }: RootStackScreenProps<'ReportProblem'>) {
  const { dealId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const write = useDealWrite(dealId);
  const [category, setCategory] = useState<DisputeCategory | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);

  const s = useMemo(() => StyleSheet.create({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl * 3 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    photo: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.photo },
    remove: { position: 'absolute', top: -spacing.sm, right: -spacing.sm },
    count: { ...type('caption'), color: colors.textMuted },
  }), [colors, type]);

  const text = description.trim();
  const length = [...text].length;
  const descriptionError = length < DEAL_LIMITS.disputeDescriptionMin
    ? t('deals.problem.tooShort', { min: DEAL_LIMITS.disputeDescriptionMin })
    : length > DEAL_LIMITS.disputeDescriptionMax ? t('deals.problem.tooLong', { max: DEAL_LIMITS.disputeDescriptionMax }) : undefined;
  const left = DEAL_LIMITS.disputePhotosMax - photos.length;

  const addPhotos = async () => {
    if (left <= 0) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: true, selectionLimit: left,
      });
      if (result.canceled) return;
      const picked = result.assets.slice(0, left).map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
      setPhotos((p) => [...p, ...picked].slice(0, DEAL_LIMITS.disputePhotosMax));
    } catch {
      Toast.show({ type: 'error', text1: t('deals.photos.pickFailed') });
    }
  };

  const submit = async () => {
    setTried(true);
    if (!category) {
      Toast.show({ type: 'error', text1: t('deals.problem.categoryRequired') });
      return;
    }
    if (descriptionError) return;
    const keys: string[] = [];
    setUploading(true);
    try {
      const done = { ...uploaded };
      for (const p of photos) {
        if (!done[p.uri]) done[p.uri] = await uploadDealPhoto(dealId, p.uri, { width: p.width, height: p.height });
        keys.push(done[p.uri]!);
      }
      setUploaded(done);
    } catch (err) {
      Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
      return;
    } finally {
      setUploading(false);
    }
    write.mutate(
      { action: 'problem', body: { category, description: text, ...(keys.length ? { photoKeys: keys } : {}) } },
      {
        onSuccess: () => {
          track(DEAL_EVENTS.problemReported, { category, photos: keys.length });
          Toast.show({ type: 'success', text1: t('deals.problem.sent') });
          navigation.goBack();
        },
        onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
      },
    );
  };

  return (
    <ScreenWrapper keyboardAware>
      <Header title={t('deals.problem.title')} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Notice tone="info" icon={Info} text={t('deals.problem.intro')} />
        <Field label={t('deals.problem.category')}>
          <View style={s.chips}>
            {DISPUTE_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={t(`deals.category.${c}`)}
                selected={category === c}
                onPress={() => setCategory(c)}
                role="radio"
                testID={`Problem-category-${c}`}
              />
            ))}
          </View>
        </Field>
        <Input
          label={t('deals.problem.description')}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder={t('deals.problem.descriptionHint')}
          error={tried ? descriptionError : undefined}
          testID="Problem-description"
        />
        <Field label={t('deals.problem.photos')} hint={t('deals.problem.photosHint', { max: DEAL_LIMITS.disputePhotosMax })}>
          <View style={s.photos}>
            {photos.map((p) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={s.photo} contentFit="cover" accessibilityIgnoresInvertColors />
                <IconButton
                  icon={X}
                  onPress={() => setPhotos((all) => all.filter((x) => x.uri !== p.uri))}
                  accessibilityLabel={t('deals.photos.remove')}
                  testID={`Problem-photo-remove-${photos.indexOf(p)}`}
                  iconSize={16}
                  style={s.remove}
                />
              </View>
            ))}
          </View>
          {left > 0 ? (
            <Button
              title={t('deals.problem.addPhotos')}
              onPress={() => void addPhotos()}
              variant="outline"
              size="sm"
              icon={ImagePlus}
              phLabel="Problem-add-photos"
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </Field>
      </ScrollView>
      <FooterBar>
        <Button
          title={t('deals.problem.send')}
          onPress={() => void submit()}
          loading={uploading || write.isPending}
          size="md"
          phLabel="Problem-send"
        />
      </FooterBar>
    </ScreenWrapper>
  );
}
