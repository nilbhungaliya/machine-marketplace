import type { MachineTypeDetails } from './embroidery.js';
import type { SeedField, SeedPartGroup } from './types.js';

// Water-jet loom in full (spec §10): machine fields, eleven part groups and side settings. Temples and side frames come
// as left / right parts, so those two groups have sides; the loom's convention is the weaver's view.

/** The part a part-group listing is for; options end with Other. */
const item = (...pairs: [key: string, label: string][]): SeedField => ({
  key: 'item', label: 'Part', type: 'single_select', appliesTo: 'parts', required: true, filterable: true, highlightRank: 1,
  options: [...pairs.map(([key, label]) => ({ key, label })), { key: 'other', label: 'Other' }],
});

const group = (name: string, items: [string, string][], hasSides?: boolean): SeedPartGroup => ({
  name,
  ...(hasSides === undefined ? {} : { hasSides }),
  fields: [item(...items)],
});

export const WATER_JET_DETAILS: Record<string, MachineTypeDetails> = {
  'Water Jet Loom': {
    sideConvention: 'Left and right as seen by the weaver standing at the front of the loom, facing it.',
    fields: [
      {
        key: 'reed_space', label: 'Reed space', type: 'number', appliesTo: 'machines', unit: 'cm', min: 150, max: 400,
        required: true, filterable: true, highlightRank: 1,
      },
      {
        key: 'nozzles', label: 'Nozzles', type: 'single_select', appliesTo: 'machines', required: true, filterable: true, highlightRank: 2,
        options: [
          { key: 'single', label: 'Single' },
          { key: 'double', label: 'Double' },
          { key: 'triple', label: 'Triple' },
        ],
      },
      {
        key: 'shedding', label: 'Shedding', type: 'single_select', appliesTo: 'machines', required: true, filterable: true, highlightRank: 3,
        options: [
          { key: 'crank', label: 'Crank' },
          { key: 'cam', label: 'Cam' },
          { key: 'dobby', label: 'Dobby' },
          { key: 'electronic_dobby', label: 'Electronic dobby' },
        ],
      },
      { key: 'rpm', label: 'Speed (rpm)', type: 'number', appliesTo: 'machines', min: 300, max: 1500, filterable: true, highlightRank: 4 },
    ],
    partGroups: [
      group('Nozzles & Water Pumps', [['nozzle', 'Nozzle'], ['water_pump', 'Water pump'], ['pump_plunger', 'Pump plunger'], ['valve', 'Valve']]),
      group('Weft Measuring & Feeders', [['measuring_drum', 'Measuring drum'], ['weft_feeder', 'Weft feeder'], ['weft_tensioner', 'Weft tensioner']]),
      group('Shedding (Cams, Dobby, Heald Frames)', [['cam', 'Cam'], ['dobby', 'Dobby'], ['heald_frame', 'Heald frame'], ['heald_wire', 'Heald wire']]),
      group('Reed & Beat-up', [['reed', 'Reed'], ['sley', 'Sley'], ['crank_arm', 'Crank arm']]),
      group('Take-up & Let-off', [['take_up_roller', 'Take-up roller'], ['let_off', 'Let-off motion'], ['back_rest', 'Back rest']]),
      group('Temples & Selvedge', [['temple', 'Temple'], ['temple_ring', 'Temple ring'], ['selvedge_device', 'Selvedge device'], ['leno_device', 'Leno device']], true),
      group('Cutters', [['weft_cutter', 'Weft cutter'], ['cutter_blade', 'Cutter blade']]),
      group('Electronics & Sensors', [['control_board', 'Control board'], ['weft_sensor', 'Weft sensor'], ['warp_stop', 'Warp stop'], ['display_panel', 'Display panel']]),
      group('Motors & Clutch-brake', [['main_motor', 'Main motor'], ['clutch', 'Clutch'], ['brake', 'Brake']]),
      group('Side Frames & Structure', [['side_frame', 'Side frame'], ['cross_rail', 'Cross rail'], ['cover', 'Cover']], true),
      group('Bearings, Gears & Belts', [['bearing', 'Bearing'], ['gear', 'Gear'], ['belt', 'Belt']]),
    ],
  },
};
