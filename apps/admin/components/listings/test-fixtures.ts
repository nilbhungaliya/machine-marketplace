import type {
  AdminListingDetail, AdminListingList, AdminListingRow, AdminModerationRow, ListingStatus,
} from '@mpm/shared-types';

// Shared by the listing component tests (F2 plan Tasks 17, 18).

type DetailListing = AdminListingDetail['listing'];

export const FULL_PHOTO_URL = 'https://media.example.test/listings/l1/p1-full.jpg';
export const THUMB_PHOTO_URL = 'https://media.example.test/listings/l1/p1-thumb.jpg';

/** A part waiting for review: an unverified seller, a price flag, one photo, one video, a godown address. */
export function detailFixture(over: Partial<DetailListing> = {}, rest: Partial<Omit<AdminListingDetail, 'listing'>> = {}): AdminListingDetail {
  const listing: DetailListing = {
    id: 'l1',
    ref: 100123,
    kind: 'part',
    status: 'pending_review',
    title: 'Temple roller, left',
    side: 'left',
    condition: { key: 'used', label: 'Used' },
    quantity: '14',
    unit: { key: 'pcs', label: 'Pieces', decimals: 0 },
    priceModel: 'negotiable',
    pricePaise: 42000,
    gstMode: 'extra',
    rate: null,
    thumbUrl: THUMB_PHOTO_URL,
    city: 'Rajkot',
    industrialAreaName: 'Aji GIDC',
    distanceKm: null,
    refreshedAt: '2026-11-18T05:00:00.000Z',
    businessId: 'b1',
    saved: null,
    tags: [],
    description: 'Two rollers off a running loom, light wear.',
    categoryId: 'pg1',
    categoryPath: ['Textile machinery', 'Rapier looms', 'Temples'],
    specs: { material: 'steel', rings: 14 },
    partNumber: 'TP-200 L',
    partBrand: { id: 'br1', name: 'Lakshmi' },
    minOrderQty: '2',
    conditionNote: null,
    delivery: ['pickup', 'ship'],
    state: 'Gujarat',
    media: [
      {
        id: 'm1', type: 'photo', url: FULL_PHOTO_URL, thumbUrl: THUMB_PHOTO_URL, contentType: 'image/jpeg',
        sizeBytes: 812_000, durationMs: null, sortOrder: 0,
      },
      {
        id: 'm2', type: 'video', url: 'https://media.example.test/listings/l1/v1.mp4',
        thumbUrl: 'https://media.example.test/listings/l1/v1-poster.jpg', contentType: 'video/mp4', sizeBytes: 9_000_000,
        durationMs: 42_000, sortOrder: 1,
      },
    ],
    fitments: [
      {
        id: 'f1', brandId: 'br2', brandName: 'Picanol', modelId: null, modelName: null, modelOther: 'GTX Plus',
        yearFrom: 2012, yearTo: 2020, note: null, source: 'seller',
      },
    ],
    machine: null,
    rental: null,
    seller: {
      businessId: 'b1', displayName: 'Shree Ambica Engineering', industrialAreaName: 'Aji GIDC', city: 'Rajkot',
      gstVerified: false, memberSince: '2026-10-01T05:00:00.000Z', liveListings: 2,
    },
    isOwner: false,
    publishedAt: '2026-11-18T05:00:00.000Z',
    version: 4,
    unitId: 'u1',
    conditionId: 'c1',
    partBrandId: 'br1',
    flags: ['price_check'],
    acceptedFlags: [],
    reviewReasons: ['unverified_seller', 'price_check'],
    needsAttention: [],
    reviewOnEdit: false,
    expiresAt: null,
    expiringSoon: false,
    moderation: null,
    statusReason: null,
    score: { score: 65, missing: ['video'] },
    location: {
      source: 'godown', pincode: '360003', city: 'Rajkot', state: 'Gujarat', industrialAreaId: 'ia1',
      industrialAreaName: 'Aji GIDC', industrialAreaOther: null, addressLine: 'Shed 14, Road B', lat: 22.29, lng: 70.8,
    },
    createdAt: '2026-11-17T05:00:00.000Z',
    updatedAt: '2026-11-18T05:00:00.000Z',
    returnStatus: null,
    firstLiveAt: null,
    statusChangedAt: '2026-11-18T05:00:00.000Z',
    ...over,
  };
  return {
    listing,
    sideConvention: 'Left and right as seen by the operator standing at the front of the machine, facing it.',
    seller: {
      businessId: 'b1', name: 'Shree Ambica Engineering', gstVerified: false, ownerStatus: 'active',
      memberSince: '2026-10-01T05:00:00.000Z', listingsByStatus: { live: 2, pending_review: 1 }, everLive: 2,
    },
    reports: [],
    history: [
      {
        id: 'h1', fromStatus: 'draft', toStatus: 'pending_review', action: 'publish', actor: 'seller', adminName: null,
        reason: null, createdAt: '2026-11-18T05:00:00.000Z',
      },
    ],
    ...rest,
  };
}

/** A machine for sale, with the private serial number. */
export function machineFixture(over: Partial<DetailListing> = {}): AdminListingDetail {
  return detailFixture({
    kind: 'machine',
    title: 'Rapier loom, 190 cm',
    side: null,
    partNumber: null,
    partBrand: null,
    fitments: [],
    categoryPath: ['Textile machinery', 'Rapier looms'],
    machine: {
      brandId: null, brandName: null, brandOther: 'Jinlong', modelId: null, modelName: null, modelOther: 'JL-190',
      year: 2016, hoursRun: 21000, underPower: true, inspectionByAppointment: true, reasonForSale: 'Upgrading',
      serialNumber: 'SN-44821-B',
    },
    ...over,
  });
}

export function moderationRow(over: Partial<AdminModerationRow> = {}): AdminModerationRow {
  return {
    id: 'l1',
    ref: 100123,
    thumbUrl: THUMB_PHOTO_URL,
    title: 'Temple roller, left',
    kind: 'part',
    status: 'pending_review',
    side: 'left',
    business: { id: 'b1', name: 'Shree Ambica Engineering', gstVerified: false },
    reviewReasons: ['first_listings'],
    statusChangedAt: '2026-11-18T05:00:00.000Z',
    openReports: 0,
    lastReportAt: null,
    decision: null,
    ...over,
  };
}

export function listingRow(id: string, status: ListingStatus = 'live', over: Partial<AdminListingRow> = {}): AdminListingRow {
  return {
    id,
    ref: 100100 + Number(id.replace(/\D/g, '') || 0),
    thumbUrl: null,
    title: `Listing ${id}`,
    kind: 'part',
    status,
    categoryPath: ['Textile machinery', 'Rapier looms', 'Temples'],
    city: 'Surat',
    side: 'left',
    business: { id: 'b1', name: 'Shree Ambica Engineering' },
    priceModel: 'fixed',
    pricePaise: 50000,
    rate: null,
    flags: [],
    openReports: 0,
    updatedAt: '2026-11-18T05:00:00.000Z',
    ...over,
  };
}

export function listFixture(rows: AdminListingRow[], over: Partial<AdminListingList> = {}): AdminListingList {
  return { rows, total: rows.length, page: 1, pageSize: 25, business: null, ...over };
}
