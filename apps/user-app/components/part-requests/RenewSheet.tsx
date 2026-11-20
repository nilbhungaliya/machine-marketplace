import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import { formatDayMonth } from '@/lib/format-date';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The days a renew may add (F8 spec §9.1, R5, plan D9): one of the validity settings, `max(now, expiresAt) + days` not
 * past `renewableUntil` (first post + the max days; the API answers `409 PART_REQUEST_MAX_DAYS` otherwise).
 */
export function renewChoices(validityDays: readonly number[], expiresAt: string, renewableUntil: string, now = Date.now()): { days: number; ok: boolean }[] {
  const from = Math.max(now, Date.parse(expiresAt));
  const until = Date.parse(renewableUntil);
  return validityDays.map((days) => ({ days, ok: from + days * DAY_MS <= until }));
}

/** Renew a requirement (active or expired): pick how many more days, then Renew. */
export default function RenewSheet({ visible, validityDays, expiresAt, renewableUntil, busy, onClose, onConfirm }: {
  visible: boolean;
  validityDays: readonly number[];
  expiresAt: string;
  renewableUntil: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (days: number) => void;
}) {
  const { t } = useTranslation();
  const choices = renewChoices(validityDays, expiresAt, renewableUntil);
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => {
    if (visible) setDays(choices.find((c) => c.ok)?.days ?? null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = choices.every((c) => !c.ok);

  return (
    <ActionSheet
      visible={visible}
      title={t('requirements.renew.title')}
      subtitle={none ? t('requirements.renew.maxReached') : t('requirements.renew.body', { date: formatDayMonth(Date.parse(renewableUntil)) })}
      items={choices.map((c) => ({
        key: String(c.days),
        label: t('requirements.renew.days', { count: c.days }),
        selected: days === c.days,
        disabled: !c.ok,
        testID: `Requirement-renew-${c.days}`,
      }))}
      onSelect={(key) => setDays(Number(key))}
      onClose={onClose}
    >
      <Button
        title={t('requirements.renew.confirm')}
        size="md"
        disabled={days === null || none}
        loading={busy}
        phLabel="Requirement-renew-confirm"
        onPress={() => days !== null && onConfirm(days)}
      />
    </ActionSheet>
  );
}
