import { describe, expect, it } from 'vitest';
import { adminPartRequestsQuery, queryFromUrl } from './part-requests-api';

const CAT = '7d1f3c2a-5b6e-4f80-9a1b-2c3d4e5f6a7b';
const BIZ = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('adminPartRequestsQuery (F8 §14)', () => {
  it('writes every filter the API reads, reported as true / false', () => {
    expect(adminPartRequestsQuery({
      status: 'active', kind: 'part', machineCategoryId: CAT, reported: false, businessId: BIZ,
      from: '2026-11-01T00:00:00+05:30', to: '2026-11-21T00:00:00+05:30', q: ' Ambica ', page: 2, pageSize: 50,
    })).toBe(
      `status=active&kind=part&machineCategoryId=${CAT}&reported=false&businessId=${BIZ}`
      + '&from=2026-11-01T00%3A00%3A00%2B05%3A30&to=2026-11-21T00%3A00%3A00%2B05%3A30&q=Ambica&page=2&pageSize=50',
    );
    expect(adminPartRequestsQuery({ reported: true })).toBe('reported=true');
  });

  it('drops empty filters and page 1', () => {
    expect(adminPartRequestsQuery({ q: '  ', page: 1, status: undefined, reported: undefined })).toBe('');
  });

  it('reads the URL: unknown values dropped, days as India-time bounds with an exclusive end', () => {
    expect(queryFromUrl({
      q: '', status: 'bogus', kind: 'machine', machineCategoryId: 'not-a-uuid', reported: 'true', businessId: BIZ,
      from: '2026-11-01', to: '2026-11-30', page: '3', pageSize: '100',
    })).toEqual({
      kind: 'machine', reported: true, businessId: BIZ, from: '2026-11-01T00:00:00+05:30', to: '2026-12-01T00:00:00+05:30',
      page: 3, pageSize: 100,
    });
  });
});
