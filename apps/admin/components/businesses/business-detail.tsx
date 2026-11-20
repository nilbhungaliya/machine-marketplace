'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { BellRing, CalendarClock, ExternalLink, MapPin, Package } from 'lucide-react';
import { DEAL_STATUSES, type AdminAuditEntry, type AdminBusinessDetail, type GstState } from '@mpm/shared-types';
import StatusBadge from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { GstHistory } from '@/components/verification/gst-history';
import { useAuth } from '@/lib/auth-context';
import {
  ACCOUNT_STATUS_LABELS, ACTIVITY_LABELS, MEMBER_ROLE_LABELS, VERIFICATION_LABELS, VERIFICATION_TONE, mapsLink,
} from '@/lib/businesses-api';
import { DEAL_STATUS_LABELS, formatDealRef } from '@/lib/deals-api';
import { DISPUTE_CATEGORY_LABELS, DISPUTE_OUTCOME_SHORT, DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES } from '@/lib/disputes-api';
import { REVIEW_FACET_LABELS } from '@/lib/reviews-admin-api';
import { formatBookingRef } from '@/lib/rentals-api';
import { constitutionLabel } from '@/lib/verification-api';
import { formatDate, formatDateTime, formatPhone } from '@/lib/utils';
import { StatusActionDialog, type StatusAction } from './status-action-dialog';

const GST_STATE_LABELS: Record<GstState, string> = {
  none: 'Not started',
  found: 'Lookup found, waiting for the business',
  code_sent: 'Code sent to the registered contact',
  under_review: 'Under review',
  needs_more: 'Officer asked for more',
  rejected: 'Review rejected',
  verified: 'Verified',
  revoked: 'Revoked by an officer',
};

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-3.5 gap-y-2 text-sm sm:grid-cols-[150px_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
          <dd className="mb-1.5 font-semibold text-gray-900 sm:mb-0">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const chip = (text: string, key?: string) => (
  <span key={key ?? text} className="inline-flex h-6 items-center rounded-full bg-gray-100 px-[9px] text-[12.5px] font-semibold text-gray-700">{text}</span>
);

/** An audit row's action in words: `user.suspend` → "User suspend". */
const actionLabel = (action: string) => {
  const s = action.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function AuditList({ entries }: { entries: AdminAuditEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-gray-500">No admin actions yet.</p>;
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
      {entries.map((e) => {
        const after = e.after as Record<string, unknown> | null;
        const reason = after && typeof after === 'object' && typeof after.reason === 'string' ? after.reason : null;
        return (
          <li key={e.id} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-gray-900">{actionLabel(e.action)}</span>
              <span className="text-gray-500">by {e.adminName ?? 'a deleted admin'}</span>
              <span className="ml-auto text-xs text-gray-500 tnum">{formatDateTime(e.createdAt)}</span>
            </div>
            {reason && <p className="mt-0.5 text-gray-700">{reason}</p>}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-800">Before and after</summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
                {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
              </pre>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Deals by status, disputes with outcomes and the seller score (F6 + F7 spec §9.6, §10.4, §16.1). Deal refs open the
 * deal for support / operations, disputes open for support; others read the history without the links.
 */
function DealsPanel({ business, canOpenDeals, canOpenDisputes }: {
  business: AdminBusinessDetail;
  canOpenDeals: boolean;
  canOpenDisputes: boolean;
}) {
  const { dealHistory: h, sellerScore: score } = business;
  const total = DEAL_STATUSES.reduce((n, st) => n + (h.byStatus[st] ?? 0), 0);
  const name = business.profile.tradeName;
  return (
    <Panel
      title="Deals and reviews"
      action={canOpenDeals && total > 0 && (
        <Link href={`/deals/?search=${encodeURIComponent(name)}`} className="text-sm font-bold text-brand-700 hover:underline">
          Deals ({total})
        </Link>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {DEAL_STATUSES.map((st) => (
            <span key={st} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm">
              <span className="text-gray-600">{DEAL_STATUS_LABELS[st]}</span>
              <span className="font-bold text-gray-900 tnum">{h.byStatus[st] ?? 0}</span>
            </span>
          ))}
        </div>

        <div>
          <h3 className="mb-1.5 text-[13px] font-bold text-gray-600">Seller score</h3>
          {score ? (
            <p className="text-sm text-gray-900">
              <span className="font-bold tnum">{score.stars.toFixed(1)}</span> / 5 from <span className="tnum">{score.count}</span> reviews
              <span className="text-gray-600">
                {' · '}
                {(Object.entries(score.facetsPercent) as Array<[keyof typeof score.facetsPercent, number]>)
                  .map(([facet, pct]) => `${REVIEW_FACET_LABELS[facet]} ${pct}%`).join(' · ')}
              </span>
            </p>
          ) : (
            <p className="text-sm text-gray-500">Not enough published reviews yet (shown as &ldquo;New seller&rdquo;).</p>
          )}
        </div>

        <div>
          <h3 className="mb-1.5 text-[13px] font-bold text-gray-600">Disputes</h3>
          {h.disputes.length === 0 ? (
            <p className="text-sm text-gray-500">None.</p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {h.disputes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  {canOpenDisputes ? (
                    <Link href={`/disputes/${d.id}/`} className="font-semibold text-brand-700 hover:underline">{DISPUTE_CATEGORY_LABELS[d.category]}</Link>
                  ) : (
                    <span className="font-semibold text-gray-900">{DISPUTE_CATEGORY_LABELS[d.category]}</span>
                  )}
                  {d.subject.kind === 'rental' ? (
                    // M14 R12: a rental booking dispute links to its booking (Rental bookings has the Deals roles).
                    <span className="font-mono text-[13px] text-gray-500">
                      <span className="font-sans">Booking </span>
                      {canOpenDeals
                        ? <Link href={`/rentals/${d.subject.rentalBookingId}/`} className="hover:underline">{formatBookingRef(d.rentalBookingRef)}</Link>
                        : formatBookingRef(d.rentalBookingRef)}
                    </span>
                  ) : (
                    <span className="font-mono text-[13px] text-gray-500">
                      {canOpenDeals
                        ? <Link href={`/deals/${d.dealId}/`} className="hover:underline">{formatDealRef(d.dealRef)}</Link>
                        : formatDealRef(d.dealRef)}
                    </span>
                  )}
                  <StatusBadge status={d.status} label={DISPUTE_STATUS_LABELS[d.status]} tone={DISPUTE_STATUS_TONES[d.status]} />
                  {d.outcome && <span className="text-gray-700">Outcome: {DISPUTE_OUTCOME_SHORT[d.outcome].toLowerCase()}</span>}
                  <span className="ml-auto text-xs text-gray-500 tnum">{formatDate(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * One business for Users & businesses (F1 + A2 spec §8.2): profile, location, GST, users, GST history, audit entries.
 * Buttons show by role: Suspend / Reinstate (officer, moderator), Block / Unblock (super admin), Revoke GST / Release
 * GSTIN (officer); super_admin passes every check. The API enforces the same roles.
 */
export function BusinessDetail({ business, categoryNames, onChanged }: {
  business: AdminBusinessDetail;
  /** Machine category names by id; null while loading or when the catalogue couldn't be read. */
  categoryNames: Map<string, string> | null;
  onChanged: () => void;
}) {
  const { hasRole, isSuperAdmin } = useAuth();
  const [action, setAction] = useState<StatusAction | null>(null);
  const { profile: p, gst } = business;
  const loc = p.location;

  const canSuspend = hasRole('verification_officer', 'moderator');
  const canBlock = isSuperAdmin;
  const canGst = hasRole('verification_officer');
  // The same roles as Parts & machinery in the nav (F2 spec §11.6).
  const canSeeListings = hasRole('moderator', 'support');
  // The same roles as Rental bookings in the nav (M14 spec §15).
  const canSeeRentals = hasRole('operations', 'support');
  const rentals = business.rentalBookingCount;
  const verified = gst.state === 'verified';
  const showRevoke = canGst && verified;
  const showRelease = canGst && !verified && p.gstin !== null;

  const categories = categoryNames
    ? p.categories.flatMap((id) => (categoryNames.has(id) ? [categoryNames.get(id)!] : []))
    : null;

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Business"
          action={(canSeeListings || canSeeRentals) && (
            <span className="flex flex-wrap items-center gap-3">
              {canSeeListings && (
                <>
                  <Link
                    href={`/listings/?businessId=${p.id}`}
                    className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline"
                  >
                    <Package size={13} aria-hidden /> Listings ({business.listingsCount})
                  </Link>
                  {/* Part requests has the same roles as Parts & machinery (F8 spec §14). */}
                  <Link
                    href={`/part-requests/?businessId=${p.id}`}
                    className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline"
                  >
                    <BellRing size={13} aria-hidden /> Part requests ({business.partRequestCount})
                  </Link>
                </>
              )}
              {/* M14 §15: as the owner and as the renter; the list's business filter matches either side. */}
              {canSeeRentals && (
                <Link
                  href={`/rentals/?businessId=${p.id}`}
                  className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline"
                  title={`${rentals.asOwner} as the owner, ${rentals.asRenter} as the renter`}
                >
                  <CalendarClock size={13} aria-hidden /> Rental bookings ({rentals.asOwner + rentals.asRenter})
                  <span className="font-normal text-gray-500">· {rentals.asOwner} owner, {rentals.asRenter} renter</span>
                </Link>
              )}
            </span>
          )}
        >
          <Facts
            rows={[
              ['Shown as', p.displayName],
              ['Business name', p.tradeName],
              ['Legal name', p.legalName ?? '—'],
              ['Does', <span key="a" className="flex flex-wrap gap-1.5">{p.activities.length ? p.activities.map((a) => chip(ACTIVITY_LABELS[a], a)) : '—'}</span>],
              ['Machines', categories === null
                ? `${p.categories.length} categories`
                : <span key="c" className="flex flex-wrap gap-1.5">{categories.length ? categories.map((c) => chip(c)) : '—'}</span>],
              ['Email', p.email ?? '—'],
              ['Established', p.yearEstablished ?? '—'],
              ['Employees', p.employees ?? '—'],
              ['Onboarding', p.onboarding === 'done' ? 'Finished' : `At the ${p.onboarding} step`],
            ]}
          />
        </Panel>

        <Panel
          title="Location"
          action={loc.lat !== null && loc.lng !== null && (
            <a href={mapsLink(loc.lat, loc.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
              <MapPin size={13} aria-hidden /> Open in Google Maps <ExternalLink size={12} aria-hidden />
            </a>
          )}
        >
          <Facts
            rows={[
              ['Pincode', loc.pincode ? <span className="tnum">{loc.pincode}</span> : '—'],
              ['City', loc.city ?? '—'],
              ['State', loc.state ?? '—'],
              ['Industrial area', loc.industrialAreaName ?? (loc.industrialAreaOther ? `Other: ${loc.industrialAreaOther}` : '—')],
              ['Address', loc.addressLine ?? '—'],
              ['Pin', loc.lat !== null && loc.lng !== null ? <span className="tnum">{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span> : 'Not set'],
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="GST"
        action={(showRevoke || showRelease) && (
          <span className="flex flex-wrap items-center gap-2">
            {showRevoke && (
              <Button variant="danger" size="sm" onClick={() => setAction({ kind: 'revoke', businessId: p.id, name: p.displayName })}>Revoke GST</Button>
            )}
            {showRelease && (
              <Button
                variant="secondary"
                size="sm"
                disabled={business.reviewOpen}
                aria-describedby={business.reviewOpen ? 'release-hint' : undefined}
                onClick={() => setAction({ kind: 'release', businessId: p.id, name: p.displayName })}
              >
                Release GSTIN
              </Button>
            )}
          </span>
        )}
      >
        {showRelease && business.reviewOpen && (
          <p id="release-hint" className="mb-3 text-[13px] text-gray-600">Decide the open GST review first.</p>
        )}
        <Facts
          rows={[
            ['Verification', <StatusBadge key="v" status={p.verificationStatus} label={VERIFICATION_LABELS[p.verificationStatus]} tone={VERIFICATION_TONE[p.verificationStatus]} />],
            ['GST state', GST_STATE_LABELS[gst.state] ?? gst.state],
            ['GSTIN', p.gstin ? <span className="font-mono text-[13px]">{p.gstin}</span> : 'None'],
            ['Latest note', business.verificationNote ?? '—'],
            ['Constitution', constitutionLabel(p.constitution)],
            ['Registered on', p.gstRegisteredOn ? formatDate(p.gstRegisteredOn) : '—'],
            ['GST address', p.gstAddress ? `${p.gstAddress.line}, ${p.gstAddress.city}, ${p.gstAddress.state} ${p.gstAddress.pincode}` : '—'],
            ['Verified on', p.verifiedAt ? formatDate(p.verifiedAt) : '—'],
          ]}
        />
      </Panel>

      <Panel title="Users">
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table aria-label="Users" className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50/80">
              <tr>
                {['Name', 'Phone', 'Role', 'Status', 'Joined', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h || <span className="sr-only">Actions</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {business.users.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-500">Nobody on this business.</td></tr>
              ) : business.users.map((u) => {
                const name = u.name ?? formatPhone(u.phone);
                const target = { userId: u.id, name };
                return (
                  <tr key={u.id}>
                    <td className="px-3 py-2 font-semibold text-gray-900">{u.name ?? '—'}</td>
                    <td className="px-3 py-2 tnum">{formatPhone(u.phone)}</td>
                    <td className="px-3 py-2">{MEMBER_ROLE_LABELS[u.memberRole]}</td>
                    <td className="px-3 py-2"><StatusBadge status={u.status} label={ACCOUNT_STATUS_LABELS[u.status]} /></td>
                    <td className="px-3 py-2 tnum">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex gap-1.5">
                        {u.status === 'active' && canSuspend && (
                          <Button variant="secondary" size="sm" onClick={() => setAction({ kind: 'suspend', ...target })}>Suspend</Button>
                        )}
                        {u.status === 'suspended' && canSuspend && (
                          <Button variant="secondary" size="sm" onClick={() => setAction({ kind: 'reinstate', ...target })}>Reinstate</Button>
                        )}
                        {u.status !== 'blocked' && canBlock && (
                          <Button variant="danger" size="sm" onClick={() => setAction({ kind: 'block', ...target })}>Block</Button>
                        )}
                        {u.status === 'blocked' && canBlock && (
                          <Button variant="secondary" size="sm" onClick={() => setAction({ kind: 'unblock', ...target })}>Unblock</Button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <DealsPanel business={business} canOpenDeals={hasRole('support', 'operations')} canOpenDisputes={hasRole('support')} />

      <Panel title="GST history">
        <GstHistory history={business.history} />
      </Panel>

      <Panel title="Audit">
        <AuditList entries={business.audit} />
      </Panel>

      {action && <StatusActionDialog action={action} onClose={() => setAction(null)} onDone={onChanged} />}
    </div>
  );
}
