'use client';

import type { ReactNode } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import type { AdminListingDetail, EffectiveTemplate, Fitment, RentalPeriod, SpecValue } from '@mpm/shared-types';
import { mapsLink } from '@/lib/businesses-api';
import {
  DELIVERY_LABELS, FUEL_LABELS, GST_MODE_LABELS, OPERATOR_LABELS, PRICE_MODEL_LABELS, RENTAL_PERIOD_LABELS, SIDE_LABELS,
  TRANSPORT_LABELS, formatPaise,
} from '@/lib/listings-api';
import { formatDate } from '@/lib/utils';

/** Text the seller typed as "Other" (a brand, model or area not in the catalogue): highlighted for the moderator. */
export function OtherText({ children }: { children: string }) {
  return (
    <span data-other title="Typed by the seller as Other" className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-1.5 py-0.5 text-amber-900">
      <span>{children}</span>
      <span className="rounded-full bg-white px-1.5 text-[10.5px] font-extrabold uppercase text-amber-800">Other</span>
    </span>
  );
}

export function Facts({ rows }: { rows: Array<[string, ReactNode] | null | false> }) {
  const shown = rows.filter((r): r is [string, ReactNode] => !!r);
  return (
    <dl className="grid grid-cols-1 gap-x-3.5 gap-y-2 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="mb-1.5 font-semibold text-gray-900 sm:mb-0">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

function fitLine(f: Fitment) {
  const years = f.yearFrom || f.yearTo ? ` (${f.yearFrom ?? '…'}–${f.yearTo ?? '…'})` : '';
  return (
    <li key={f.id ?? `${f.brandId}-${f.modelId}-${f.modelOther}`} className="flex flex-wrap items-center gap-x-1.5">
      <span>{f.brandName ?? 'Unknown brand'}</span>
      {f.modelId ? <span>{f.modelName ?? 'a model'}</span> : f.modelOther ? <OtherText>{f.modelOther}</OtherText> : <span className="font-normal text-gray-500">all models</span>}
      {years && <span className="tnum">{years}</span>}
      {f.note && <span className="font-normal text-gray-600">· {f.note}</span>}
      {f.source === 'admin' && <span className="text-xs font-normal text-gray-500">· set by a moderator</span>}
    </li>
  );
}

/** A spec value in words: option keys through the template's labels, lists joined. */
function specText(value: SpecValue, options: Map<string, string>): string {
  if (Array.isArray(value)) return value.map((v) => options.get(v) ?? v).join(', ');
  if (typeof value === 'string') return options.get(value) ?? value;
  return String(value);
}

const humanKey = (key: string) => {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * The specs table of the review screen (F2 spec §11.2): category, condition, quantity, side and its convention, fit,
 * price or rates and terms, part number and brand, machine make / model / year / hours / serial number, and the
 * template specs. "Other" brand or model texts are highlighted.
 */
export function ListingSpecs({ detail, template }: { detail: AdminListingDetail; template: EffectiveTemplate | null }) {
  const l = detail.listing;
  const m = l.machine;
  const r = l.rental;
  const fields = new Map((template?.fields ?? []).map((f) => [f.key, f]));
  const perUnit = l.unit ? ` per ${l.unit.label.toLowerCase().replace(/s$/, '')}` : '';

  const price: ReactNode = l.kind === 'machine_rental' ? null : l.priceModel === 'on_request' ? 'Price on request' : l.pricePaise != null ? (
    <span>
      <span className="tnum">{formatPaise(l.pricePaise)}</span>{perUnit}
      {l.priceModel && <span className="font-normal text-gray-600"> · {PRICE_MODEL_LABELS[l.priceModel]}</span>}
      {l.gstMode && <span className="font-normal text-gray-600"> · {GST_MODE_LABELS[l.gstMode]}</span>}
    </span>
  ) : '—';

  const rates = r ? (['hour', 'day', 'week', 'month'] as RentalPeriod[]).flatMap((p) => {
    const paise = { hour: r.rateHourPaise, day: r.rateDayPaise, week: r.rateWeekPaise, month: r.rateMonthPaise }[p];
    return paise == null ? [] : [<span key={p} className="block tnum">{formatPaise(paise)} a {RENTAL_PERIOD_LABELS[p]}</span>];
  }) : [];

  const specRows: Array<[string, ReactNode]> = Object.entries(l.specs).map(([key, value]) => {
    const field = fields.get(key);
    const options = new Map((field?.options ?? []).map((o) => [o.key, o.label]));
    const unit = field?.unit ? ` ${field.unit}` : '';
    return [field?.label ?? humanKey(key), `${specText(value, options)}${unit}`];
  });

  return (
    <div className="space-y-4">
      <Facts
        rows={[
          ['Category', l.categoryPath.length ? l.categoryPath.join(' › ') : '—'],
          l.kind !== 'machine_rental' && ['Condition', l.condition ? <span>{l.condition.label}{l.conditionNote && <span className="block font-normal text-gray-600">{l.conditionNote}</span>}</span> : '—'],
          ['Quantity', l.quantity ? <span className="tnum">{l.quantity} {l.unit?.label ?? ''}</span> : '—'],
          l.minOrderQty !== null && ['Minimum order', <span key="mo" className="tnum">{l.minOrderQty} {l.unit?.label ?? ''}</span>],
          l.kind === 'part' && ['Side', l.side ? (
            <span>
              {SIDE_LABELS[l.side]}
              {detail.sideConvention && (l.side === 'left' || l.side === 'right') && <span className="block font-normal text-gray-600">{detail.sideConvention}</span>}
            </span>
          ) : '—'],
          l.kind === 'part' && ['Fits', l.fitments.length ? <ul className="space-y-1">{l.fitments.map(fitLine)}</ul> : 'Not given'],
          l.kind === 'part' && ['Part number', l.partNumber ? <span className="font-mono text-[13px]">{l.partNumber}</span> : '—'],
          l.kind === 'part' && ['Part brand', l.partBrand?.name ?? '—'],
          price !== null && ['Price', price],
          !!m && ['Make', m.brandName ?? (m.brandOther ? <OtherText>{m.brandOther}</OtherText> : '—')],
          !!m && ['Model', m.modelName ?? (m.modelOther ? <OtherText>{m.modelOther}</OtherText> : '—')],
          !!m && ['Year', m.year ?? '—'],
          !!m && ['Hours run', m.hoursRun != null ? <span className="tnum">{m.hoursRun.toLocaleString('en-IN')}</span> : '—'],
          !!m && ['Serial number', m.serialNumber ? <span className="font-mono text-[13px]">{m.serialNumber}</span> : '—'],
          !!m && ['Can be seen running', yesNo(m.underPower)],
          !!m && ['Inspection', m.inspectionByAppointment ? 'By appointment' : 'Not arranged'],
          !!m && l.kind === 'machine' && ['Reason for sale', m.reasonForSale ?? '—'],
          !!r && ['Rates', rates.length ? <span>{rates}</span> : '—'],
          !!r && ['Day and month', `A day is ${r.shiftHours} hours; a month is ${r.monthDays} working days`],
          !!r && r.overtimeRateHourPaise != null && ['Overtime', `${formatPaise(r.overtimeRateHourPaise)} an hour`],
          !!r && r.minDuration != null && ['Minimum', `${r.minDuration} ${r.minDurationPeriod ? RENTAL_PERIOD_LABELS[r.minDurationPeriod] : ''}`.trim()],
          !!r && ['Operator', r.operator ? `${OPERATOR_LABELS[r.operator]}${r.operatorRateDayPaise != null ? `, ${formatPaise(r.operatorRateDayPaise)} a day` : ''}` : '—'],
          !!r && ['Fuel', FUEL_LABELS[r.fuel]],
          !!r && ['Transport', r.transport ? `${TRANSPORT_LABELS[r.transport]}${r.transportChargePaise != null ? `, ${formatPaise(r.transportChargePaise)} each way` : ''}` : '—'],
          !!r && r.serviceRadiusKm != null && ['Works within', `${r.serviceRadiusKm} km`],
          !!r && r.depositPaise != null && ['Deposit', formatPaise(r.depositPaise)],
          !!r && ['Available', r.availableFrom ? `From ${formatDate(r.availableFrom)}` : 'Now'],
          !!r && r.availabilityNote !== null && ['Availability note', r.availabilityNote],
          ['Delivery', l.delivery.length ? l.delivery.map((d) => DELIVERY_LABELS[d]).join(', ') : '—'],
        ]}
      />
      {specRows.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <h4 className="mb-2 text-xs font-bold text-gray-600">Specifications</h4>
          <Facts rows={specRows} />
        </div>
      )}
      {l.description && (
        <div className="border-t border-gray-100 pt-4">
          <h4 className="mb-1 text-xs font-bold text-gray-600">Description</h4>
          <p className="whitespace-pre-line text-sm text-gray-800">{l.description}</p>
        </div>
      )}
    </div>
  );
}

/** Where the stock is, private parts included (§11.2: address line, pincode, map link). */
export function ListingLocation({ detail }: { detail: AdminListingDetail }) {
  const loc = detail.listing.location;
  return (
    <div className="space-y-3">
      <Facts
        rows={[
          ['Source', loc.source === 'godown' ? 'Another godown' : "The business's address"],
          ['Industrial area', loc.industrialAreaName ?? (loc.industrialAreaOther ? <OtherText>{loc.industrialAreaOther}</OtherText> : '—')],
          ['Address', loc.addressLine ?? '—'],
          ['City', [loc.city, loc.state].filter(Boolean).join(', ') || '—'],
          ['Pincode', loc.pincode ? <span className="tnum">{loc.pincode}</span> : '—'],
          ['Pin', loc.lat !== null && loc.lng !== null ? <span className="tnum">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span> : 'Not set'],
        ]}
      />
      {loc.lat !== null && loc.lng !== null && (
        <a href={mapsLink(loc.lat, loc.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline">
          <MapPin size={13} aria-hidden /> Open in Google Maps <ExternalLink size={12} aria-hidden />
        </a>
      )}
    </div>
  );
}
