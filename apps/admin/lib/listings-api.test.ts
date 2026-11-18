import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), download: vi.fn() },
}));
import { api, ApiError } from './api';
import {
  codeWords, explainListingError, fetchAdminListings, fetchModerationWaiting, filtersFromUrl, formatPaise, listingsQuery,
} from './listings-api';

afterEach(() => { vi.clearAllMocks(); });

describe('listingsQuery', () => {
  it('writes status and flags as comma lists and reported as 1, leaving empty values out', () => {
    expect(listingsQuery({
      status: ['live', 'paused'], kind: 'part', flags: ['price_check', 'unit_check'], reported: true, businessId: 'b1', q: '',
      page: 2, pageSize: 50,
    })).toBe('status=live%2Cpaused&kind=part&flags=price_check%2Cunit_check&reported=1&businessId=b1&page=2&pageSize=50');
    expect(listingsQuery({ status: [], reported: false })).toBe('');
  });

  it('fetchAdminListings calls /admin/listings with the query', async () => {
    vi.mocked(api.get).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25, business: null });
    await fetchAdminListings({ q: '#100123' });
    expect(api.get).toHaveBeenCalledWith('/admin/listings?q=%23100123');
  });
});

const UUID = '7d1f3c2a-5b6e-4f80-9a1b-2c3d4e5f6a7b';

describe('filtersFromUrl', () => {
  it('keeps only known statuses, kinds, sides and flags', () => {
    expect(filtersFromUrl({
      status: 'live,bogus,hidden', kind: 'nope', side: 'left', flags: 'price_check,x', reported: '1', city: ' Surat ',
      machineCategoryId: '', businessId: UUID, q: 'roller', page: '3', pageSize: '100',
    })).toEqual({
      status: ['live', 'hidden'], side: 'left', flags: ['price_check'], reported: true, city: 'Surat', businessId: UUID,
      q: 'roller', page: 3, pageSize: 100,
    });
  });

  it('drops a seller or machine category that is not a uuid', () => {
    expect(filtersFromUrl({ businessId: 'b1', machineCategoryId: "1' or 1=1" })).toEqual({});
  });
});

describe('fetchModerationWaiting', () => {
  it('is the Review count plus the Reported count, for the nav badge', async () => {
    vi.mocked(api.get).mockResolvedValue({ review: 4, reported: 3 });
    expect(await fetchModerationWaiting()).toBe(7);
    expect(api.get).toHaveBeenCalledWith('/admin/moderation/counts');
  });
});

describe('explainListingError', () => {
  it('names the stale version, the missing photo and the closed reports', () => {
    expect(explainListingError(new ApiError('x', 409, 'LISTING_CHANGED'))).toMatch(/seller changed this listing/i);
    expect(explainListingError(new ApiError('x', 400, 'LISTING_INCOMPLETE'))).toBe('This listing has no photo');
    expect(explainListingError(new ApiError('x', 409, 'NO_OPEN_REPORTS'))).toMatch(/no open reports/i);
    expect(explainListingError(new ApiError('Other words', 400, 'SOMETHING'))).toBe('Other words');
  });

  it('lists the spec fields that refused the new category, and says when media storage is missing', () => {
    expect(explainListingError(new ApiError('x', 400, 'SPECS_INVALID', { material: 'option_invalid', rings: 'too_high' })))
      .toMatch(/material, rings/);
    expect(explainListingError(new ApiError('x', 503, 'STORAGE_UNAVAILABLE')))
      .toBe("Media storage isn't set up, so media can't be deleted");
    expect(explainListingError(new ApiError('x', 403, 'RENTAL_NEEDS_GST'))).toMatch(/GST/);
  });

  it('a bulk skip for the status reads plainly', () => {
    expect(codeWords('LISTING_TRANSITION_NOT_ALLOWED')).toBe("Can't be hidden or removed in its status");
    expect(codeWords('WHATEVER')).toBe('WHATEVER');
  });
});

describe('formatPaise', () => {
  it('shows rupees with Indian grouping', () => {
    expect(formatPaise(4200000)).toBe('₹42,000');
    expect(formatPaise(12345)).toBe('₹123.45');
  });
});
