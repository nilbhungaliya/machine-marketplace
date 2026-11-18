/**
 * The launch city's industrial areas (F1 spec §4.3), in the spec's order. City and state follow the pincode directory's
 * spelling (`Surat`, `Gujarat`), since the app's picker matches areas to the pincode's district and state.
 * **For the client to check** (spec §13): correct names, missing estates, Surat city vs district.
 */
const NAMES = [
  'Sachin GIDC',
  'Hojiwala Industrial Estate',
  'Pandesara GIDC',
  'Udhna Udyog Nagar',
  'Katargam GIDC',
  'Bhestan',
  'Varachha',
  'Limbayat',
  'Kadodara',
  'Palsana',
  'Kamrej',
  'Kim',
  'Ichchhapor GIDC',
  'Olpad',
] as const;

export interface IndustrialAreaSeed {
  name: string;
  city: string;
  state: string;
  sortOrder: number;
}

export const SURAT_INDUSTRIAL_AREAS: IndustrialAreaSeed[] = NAMES.map((name, i) => ({
  name,
  city: 'Surat',
  state: 'Gujarat',
  sortOrder: (i + 1) * 10,
}));
