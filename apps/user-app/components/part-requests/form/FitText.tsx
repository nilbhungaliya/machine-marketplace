import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useBrands, useModels } from '@/hooks/use-listing';
import { yearRange } from '@/lib/listing-format';
import type { FormFit } from '@/lib/part-request-form';

/**
 * One "fits" row as text ("Tata LPT 1613 · 2016–2020", "Toyota All models"): names from the form, else from the cached
 * catalogue (a prefill carries ids only).
 */
export default function FitText({ fit, style }: { fit: FormFit; style?: StyleProp<TextStyle> }) {
  const { t } = useTranslation();
  const brands = useBrands('machines');
  const models = useModels(fit.modelId && !fit.modelName ? fit.brandId : null);
  const brand = fit.brandName ?? brands.data?.find((b) => b.id === fit.brandId)?.name ?? '…';
  const model = fit.modelId ? (fit.modelName ?? models.data?.find((m) => m.id === fit.modelId)?.name ?? '…') : t('requirements.fit.allModels');
  const years = yearRange(fit.yearFrom, fit.yearTo);
  return <Text style={style} numberOfLines={2}>{[`${brand} ${model}`, years].filter(Boolean).join(' · ')}</Text>;
}
