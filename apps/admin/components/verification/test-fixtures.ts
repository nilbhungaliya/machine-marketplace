import type { AdminGstReviewDetail, GstDetails } from '@mpm/shared-types';

// Shared by the verification component tests.

export const gstDetails: GstDetails = {
  legalName: 'SHREE AMBICA ENGINEERING',
  tradeName: 'Shree Ambica Engineering',
  address: { line: 'Plot 214, Aji GIDC', city: 'Rajkot', state: 'Gujarat', pincode: '360003' },
  constitution: 'partnership',
  natureOfBusiness: null,
  registeredOn: '2011-04-01',
  status: 'active',
};

export function reviewFixture(over: Partial<AdminGstReviewDetail> = {}): AdminGstReviewDetail {
  return {
    id: 'r1',
    status: 'waiting',
    gstin: '24AAKFS4821M1Z6',
    declarationVersion: 1,
    declaredAt: '2026-11-18T05:00:00.000Z',
    createdAt: '2026-11-18T05:00:00.000Z',
    updatedAt: '2026-11-18T05:00:00.000Z',
    decidedAt: null,
    officerMessage: null,
    reason: null,
    lookupAtApproval: null,
    approvedDetails: null,
    business: {
      id: 'b1', tradeName: 'Shree Ambica Engineering', gstin: null, addressLine: 'Plot 214', city: 'Rajkot', state: 'Gujarat',
      pincode: '360003', verificationStatus: 'pending',
    },
    submittedBy: { id: 'u1', name: 'Ramesh Patel', phone: '+919825041736' },
    entered: null,
    lookup: { checkId: 'c1', details: gstDetails, resolvedAt: '2026-11-18T04:55:00.000Z' },
    mismatches: { legalName: false, pincode: false },
    documents: [],
    history: { checks: [], proofs: [], verifications: [] },
    providerAvailable: true,
    storageAvailable: false,
    ...over,
  };
}

