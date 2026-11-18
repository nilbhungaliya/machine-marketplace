import { describe, expect, it } from 'vitest';
import { SURAT_INDUSTRIAL_AREAS } from './industrial-areas.js';

// F1 spec §4.3: the Surat seed, in the spec's order, spelled as the pincode directory spells the city and state.
describe('SURAT_INDUSTRIAL_AREAS', () => {
  it('is exactly the 14 areas of the spec, in order, sort order 10, 20, …', () => {
    expect(SURAT_INDUSTRIAL_AREAS).toEqual(
      [
        'Sachin GIDC', 'Hojiwala Industrial Estate', 'Pandesara GIDC', 'Udhna Udyog Nagar', 'Katargam GIDC', 'Bhestan',
        'Varachha', 'Limbayat', 'Kadodara', 'Palsana', 'Kamrej', 'Kim', 'Ichchhapor GIDC', 'Olpad',
      ].map((name, i) => ({ name, city: 'Surat', state: 'Gujarat', sortOrder: (i + 1) * 10 })),
    );
  });
});
