import type { ListingCard, ListingOwnerView } from '@mpm/shared-types';

// Test-only builders for listing payloads (not a test file itself: no `.test.ts`, imported by the listing tests).

export function cardFixture(over: Partial<ListingCard> = {}): ListingCard {
  return {
    id: 'l1',
    ref: 100001,
    kind: 'part',
    status: 'live',
    title: 'mudguard-bracket',
    side: 'left',
    condition: { key: 'unused', label: 'unused' },
    quantity: '14',
    availableQuantity: '14',
    unit: { key: 'pcs', label: 'pieces', decimals: 0 },
    priceModel: 'negotiable',
    pricePaise: 42_000,
    gstMode: 'extra',
    rate: null,
    thumbUrl: null,
    city: 'rajkot',
    industrialAreaName: 'aji-gidc',
    distanceKm: null,
    refreshedAt: '2026-11-15T10:00:00.000Z',
    businessId: 'b1',
    saved: null,
    tags: [],
    ...over,
  };
}

/** A fresh draft: nothing filled but the kind (and the business location the server copies). */
export function ownerFixture(over: Partial<ListingOwnerView> = {}): ListingOwnerView {
  return {
    ...cardFixture({ status: 'draft', title: '', side: null, condition: null, quantity: null, priceModel: null, pricePaise: null, gstMode: null }),
    description: null,
    categoryId: null,
    categoryPath: [],
    specs: {},
    partNumber: null,
    partBrand: null,
    minOrderQty: null,
    conditionNote: null,
    delivery: [],
    state: 'gujarat',
    media: [],
    fitments: [],
    machine: null,
    rental: null,
    seller: {
      businessId: 'b1', displayName: 'shree-parts', industrialAreaName: 'aji-gidc', city: 'rajkot', gstVerified: false,
      memberSince: '2026-11-01T00:00:00.000Z', liveListings: 0, score: null,
    },
    isOwner: true,
    publishedAt: null,
    myThreadId: null,
    openNegotiation: null,
    version: 1,
    heldQuantity: '0',
    unitId: null,
    conditionId: null,
    partBrandId: null,
    flags: [],
    acceptedFlags: [],
    reviewReasons: [],
    needsAttention: [],
    reviewOnEdit: false,
    expiresAt: null,
    expiringSoon: false,
    moderation: null,
    statusReason: null,
    score: { score: 0, missing: [] },
    partRequestId: null,
    pendingRequestReply: null,
    location: {
      source: 'business', pincode: '360003', city: 'rajkot', state: 'gujarat', industrialAreaId: 'a1',
      industrialAreaName: 'aji-gidc', industrialAreaOther: null, addressLine: null, lat: null, lng: null,
    },
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...over,
  };
}
