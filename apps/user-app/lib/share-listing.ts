import type { ListingCard } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { formatRupees } from '@/lib/money';

/**
 * The text shared to WhatsApp and the system share sheet (F6 + F7 spec §6.13) from the thread menu and the listing
 * page: title, price, `#ref`, and `${baseUrl}/l/<ref>` only when a base URL is set (`EXPO_PUBLIC_SHARE_BASE_URL`; no
 * public pages yet, D1).
 */
export function shareMessage(
  listing: Pick<ListingCard, 'title' | 'ref' | 'pricePaise' | 'priceModel' | 'unit'>,
  baseUrl: string | undefined = process.env.EXPO_PUBLIC_SHARE_BASE_URL,
): string {
  const lines = [listing.title];
  if (listing.priceModel !== 'on_request' && listing.pricePaise !== null) {
    lines.push(
      listing.unit
        ? `${formatRupees(listing.pricePaise)} ${i18n.t('listing.unitFallback.per', { unit: listing.unit.label })}`
        : formatRupees(listing.pricePaise),
    );
  }
  lines.push(`#${listing.ref}`);
  const base = baseUrl?.trim().replace(/\/+$/, '');
  if (base) lines.push(`${base}/l/${listing.ref}`);
  return lines.join('\n');
}
