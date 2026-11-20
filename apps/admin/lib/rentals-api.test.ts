import { describe, expect, it } from 'vitest';
import { adminRentalsQuery } from './rentals-api';

const BIZ = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const LISTING = '7d1f3c2a-5b6e-4f80-9a1b-2c3d4e5f6a7b';

describe('adminRentalsQuery (M14 §15)', () => {
  it('drops empty filters and page 1, writes the start-date bounds as calendar days and encodes the ref search', () => {
    expect(adminRentalsQuery({ q: '  ', from: '', to: undefined, status: undefined, page: 1 })).toBe('');
    expect(adminRentalsQuery({
      status: 'confirmed', from: '2026-12-01', to: '2026-12-31', businessId: BIZ, listingId: LISTING, q: ' #700001 ',
      page: 2, pageSize: 50,
    })).toBe(`status=confirmed&from=2026-12-01&to=2026-12-31&businessId=${BIZ}&listingId=${LISTING}&q=%23700001&page=2&pageSize=50`);
  });
});
