// Periwinkle v2 admin palette (spec §4.4, ruling R3). The only file in apps/admin that holds colour values: the style
// audit (lib/style-audit.test.ts) fails on a hex or rgb colour anywhere else. tailwind.config.ts loads these into
// `theme.extend.colors`, remapping Tailwind's own `gray / red / amber / green` and defining `brand`, so existing class
// names (`bg-brand-600`, `text-gray-500`, `text-red-600`) pick up v2 with no page edits. Light only (R4); the dark values
// are recorded in the spec.

export const colors = {
  white: '#FFFFFF', // --surface
  gray: {
    50: '#F5F4FA', // --canvas
    100: '#F0EFF5', // --field
    200: '#E6E4EE', // --hair
    300: '#D6D3E0',
    400: '#8E8B9E', // --ink-3
    500: '#757287',
    600: '#5E5B6E', // --ink-2
    700: '#3A3747',
    800: '#2A2836',
    900: '#1C1A27', // --ink
    950: '#110F1F',
  },
  brand: {
    50: '#F1EEFF', // --soft2
    100: '#E1DBFF', // --soft
    200: '#C9BFFF',
    300: '#A497F3',
    400: '#8B78FF',
    500: '#7059EE',
    600: '#5B41E6', // --primary
    700: '#4A31D4', // --primary-ink
    800: '#3B26AE',
    900: '#2B1C80',
    950: '#1E1660',
  },
  red: {
    50: '#FDE6E7', // --danger-soft
    100: '#FBD3D5',
    200: '#F6B3B7',
    300: '#EF8A90',
    400: '#E5626A',
    500: '#DD4A53',
    600: '#D93A44', // --danger
    700: '#B82E37',
    800: '#942530',
    900: '#6E1B23',
    950: '#4A1218',
  },
  amber: {
    50: '#FFF1D2', // --warn-soft
    100: '#FFE6AE',
    200: '#FCD27F',
    300: '#F7BC52',
    400: '#F0B44C',
    500: '#D08A0C',
    600: '#B26F00', // --warn
    700: '#8F5900',
    800: '#6E4400',
    900: '#4F3100',
    950: '#332000',
  },
  green: {
    50: '#DFF4EA', // --ok-soft
    100: '#C5EBD9',
    200: '#9BDCBE',
    300: '#6ECB9F',
    400: '#4CCB93',
    500: '#22A56F',
    600: '#14915F', // --ok
    700: '#0F744C',
    800: '#0C5B3C',
    900: '#08402A',
    950: '#052A1C',
  },
  sun: { DEFAULT: '#FFD52E', ink: '#1C1A27' }, // badges only, never buttons (spec §6)
  photo: '#ECEBF1', // behind product shots
  scrim: 'rgb(28 20 70 / 0.45)', // modal backdrop
} as const;

/**
 * Palette class → the mockup CSS variable it must equal (spec §4.4, first table, light column). `gray-100` and
 * `gray-200` follow the v2 refinements `--field` / `--hair`; the base `--line-2` / `--line` they replace are one shade off.
 */
export const ANCHORS: Array<[path: string, mockupVar: string]> = [
  ['gray.50', 'canvas'],
  ['gray.100', 'field'],
  ['gray.200', 'hair'],
  ['gray.400', 'ink-3'],
  ['gray.600', 'ink-2'],
  ['gray.900', 'ink'],
  ['white', 'surface'],
  ['photo', 'photo'],
  ['brand.600', 'primary'],
  ['brand.700', 'primary-ink'],
  ['brand.100', 'soft'],
  ['brand.50', 'soft2'],
  ['sun.DEFAULT', 'sun'],
  ['sun.ink', 'on-sun'],
  ['green.600', 'ok'],
  ['green.50', 'ok-soft'],
  ['amber.600', 'warn'],
  ['amber.50', 'warn-soft'],
  ['red.600', 'danger'],
  ['red.50', 'danger-soft'],
  ['scrim', 'scrim'],
];
