import React from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/EmptyState';
import { TriangleAlert } from '@/lib/icons';

/**
 * The GST state couldn't be loaded and nothing is cached (offline, server down): say so and offer Retry, instead of a
 * skeleton that never ends. GstStatus, GstFound and GstCode show it in place of their content.
 */
export default function GstLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={TriangleAlert}
      title={t('verification.loadError.title')}
      subtitle={t('verification.loadError.body')}
      ctaTitle={t('common.retry')}
      ctaPhLabel="Retry-gst-state"
      onCtaPress={onRetry}
    />
  );
}
