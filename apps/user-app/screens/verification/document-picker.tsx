import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { GST_DOCUMENT_TYPES, type GstDocumentType } from '@mpm/shared-types';
import Chip from '@/components/Chip';
import { DOCUMENT_MAX_BYTES, DOCUMENT_MIME_TYPES, type DocumentProblem } from '@/lib/gst-flow';
import type { LocalDocument } from '@/lib/gst-api';
import { Camera, FileText, Images, X } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

interface PickedAsset {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

/** What to tell the user for each `documentProblem` / `newFilesProblem`. */
export const DOCUMENT_PROBLEM_KEYS: Record<DocumentProblem, string> = {
  untyped: 'verification.documents.untyped',
  fileType: 'verification.documents.fileType',
  tooLarge: 'verification.documents.tooLarge',
  count: 'verification.documents.rule',
  total: 'verification.documents.total',
  certificate: 'verification.documents.needCertificate',
  person: 'verification.documents.needPerson',
};

let seq = 0;
const nextId = () => `doc-${Date.now()}-${(seq += 1)}`;

/**
 * Review documents (F1 spec §5.3): camera, gallery (expo-image-picker) or a PDF (expo-document-picker), each file with
 * its type. The first file defaults to the GST certificate when there isn't one yet (`suggestCertificate`). Nothing is
 * uploaded here.
 */
export default function DocumentPickerField({ files, onChange, max, disabled = false, suggestCertificate = true }: {
  files: LocalDocument[];
  onChange: (files: LocalDocument[]) => void;
  /** How many files may be picked in all. */
  max: number;
  disabled?: boolean;
  /** Type the first file as the GST certificate (a new submission); off when adding to a review that has one. */
  suggestCertificate?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const room = max - files.length;

  const add = (assets: PickedAsset[], fallbackType: string) => {
    const accepted: LocalDocument[] = [];
    let hasCertificate = !suggestCertificate || files.some((f) => f.type === 'gst_certificate');
    for (const a of assets.slice(0, room)) {
      const mimeType = a.mimeType ?? fallbackType;
      if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
        Toast.show({ type: 'error', text1: t('verification.documents.fileType') });
        continue;
      }
      if ((a.size ?? 0) > DOCUMENT_MAX_BYTES) {
        Toast.show({ type: 'error', text1: t('verification.documents.tooLarge') });
        continue;
      }
      const type: GstDocumentType | null = hasCertificate ? null : 'gst_certificate';
      hasCertificate = true;
      accepted.push({ id: nextId(), uri: a.uri, name: a.name ?? a.uri.split('/').pop() ?? '', mimeType, size: a.size ?? 0, type });
    }
    if (assets.length > room) Toast.show({ type: 'info', text1: t('verification.documents.max', { count: max }) });
    if (accepted.length > 0) onChange([...files, ...accepted]);
  };

  const fromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Toast.show({ type: 'info', text1: t('verification.documents.cameraDenied') });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) add(result.assets.map((a) => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, size: a.fileSize })), 'image/jpeg');
  };

  const fromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: room,
    });
    if (!result.canceled) add(result.assets.map((a) => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, size: a.fileSize })), 'image/jpeg');
  };

  const fromFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: [...DOCUMENT_MIME_TYPES], multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) add(result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })), 'application/pdf');
  };

  const setType = (id: string, type: GstDocumentType) => onChange(files.map((f) => (f.id === id ? { ...f, type } : f)));
  const remove = (id: string) => onChange(files.filter((f) => f.id !== id));

  const s = useMemo(() => StyleSheet.create({
    file: {
      padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, gap: spacing.sm, marginBottom: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    fileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' },
    fileText: { flex: 1 },
    fileName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    fileSize: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 2 },
    remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    addRow: { flexDirection: 'row', gap: spacing.sm },
    add: {
      flex: 1, minHeight: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.primaryMuted,
    },
    addDisabled: { opacity: 0.5 },
    addText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  }), [colors]);

  const addDisabled = disabled || room <= 0;
  const addButtons = [
    { key: 'camera', icon: Camera, label: t('verification.documents.camera'), onPress: fromCamera },
    { key: 'gallery', icon: Images, label: t('verification.documents.gallery'), onPress: fromGallery },
    { key: 'pdf', icon: FileText, label: t('verification.documents.pdf'), onPress: fromFiles },
  ];

  return (
    <View>
      {files.map((f) => (
        <View key={f.id} style={s.file}>
          <View style={s.fileHead}>
            <View style={s.thumb}>
              {f.mimeType.startsWith('image/') ? (
                <Image source={{ uri: f.uri }} style={{ width: 44, height: 44, borderRadius: radius.sm }} contentFit="cover" />
              ) : (
                <FileText size={20} color={colors.textSecondary} />
              )}
            </View>
            <View style={s.fileText}>
              <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
              {f.size > 0 ? (
                <Text style={s.fileSize}>{t('verification.documents.size', { size: (f.size / 1_048_576).toFixed(1) })}</Text>
              ) : null}
            </View>
            <Pressable
              style={s.remove}
              onPress={() => remove(f.id)}
              disabled={disabled}
              testID="Remove-document"
              accessibilityRole="button"
              accessibilityLabel={t('verification.documents.remove')}
            >
              <X size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
          <View style={s.chips}>
            {GST_DOCUMENT_TYPES.map((type) => (
              <Chip
                key={type}
                label={t(`verification.documents.types.${type}`)}
                role="radio"
                selected={f.type === type}
                onPress={() => setType(f.id, type)}
                disabled={disabled}
                testID={`Document-type-${type}`}
              />
            ))}
          </View>
        </View>
      ))}
      <View style={s.addRow}>
        {addButtons.map((b) => (
          <Pressable
            key={b.key}
            style={[s.add, addDisabled && s.addDisabled]}
            onPress={() => void b.onPress()}
            disabled={addDisabled}
            testID={`Add-document-${b.key}`}
            accessibilityRole="button"
          >
            <b.icon size={20} color={colors.primary} />
            <Text style={s.addText}>{b.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
