import type { SeedField, SeedMachineType, SeedOption, SeedPartGroup } from './types.js';

// Embroidery in full (spec §10): the five embroidery machine types with machine fields and part groups. Embroidery stays
// inside "Sewing, Embroidery & Garments" (owner: mirror F2F), so embroidery-wide fields are repeated on each embroidery
// type, never set on the category, so they never reach sewing machines (spec §11 call 14). No embroidery node has sides.

export type MachineTypeDetails = Omit<Exclude<SeedMachineType, string>, 'name'>;

const options = (...pairs: [key: string, label: string][]): SeedOption[] => pairs.map(([key, label]) => ({ key, label }));
const OTHER: SeedOption = { key: 'other', label: 'Other' };

// ─── Machine fields (appliesTo machines) ───

const heads = (rank: number): SeedField => ({
  key: 'heads', label: 'Heads', type: 'number', appliesTo: 'machines', unit: 'heads', min: 1, max: 60,
  required: true, filterable: true, highlightRank: rank,
});
const needlesPerHead = (rank: number): SeedField => ({
  key: 'needles_per_head', label: 'Needles per head', type: 'number', appliesTo: 'machines', min: 1, max: 20,
  required: true, filterable: true, highlightRank: rank,
});
const maxEmbroideryArea = (rank: number): SeedField => ({
  key: 'max_embroidery_area', label: 'Max embroidery area', type: 'text', appliesTo: 'machines',
  helpText: 'e.g. 500 × 1200 mm', highlightRank: rank,
});
const headInterval: SeedField = {
  key: 'head_interval', label: 'Head interval', type: 'number', appliesTo: 'machines', unit: 'mm', min: 200, max: 600,
};
const controller: SeedField = { key: 'controller', label: 'Controller', type: 'text', appliesTo: 'machines' };
const attachments = (rank: number): SeedField => ({
  key: 'attachments', label: 'Attachments', type: 'multi_select', appliesTo: 'machines', filterable: true, highlightRank: rank,
  options: options(['sequin', 'Sequin'], ['cording', 'Cording'], ['chenille', 'Chenille'], ['boring', 'Boring'], ['taping', 'Taping'], ['laser', 'Laser']).concat(OTHER),
});

// ─── Part-group fields (appliesTo parts) ───

/** The part a part-group listing is for; options end with Other. */
const item = (...pairs: [key: string, label: string][]): SeedField => ({
  key: 'item', label: 'Part', type: 'single_select', appliesTo: 'parts', required: true, filterable: true, highlightRank: 1,
  options: [...options(...pairs), OTHER],
});

/** A part group whose first field is `item`, plus any extra fields. */
const group = (name: string, items: [string, string][], extra: SeedField[] = []): SeedPartGroup => ({
  name,
  fields: [item(...items), ...extra],
});

/** Multi and single head machines take DBxK5-family needles. */
const SELECT_NEEDLES: SeedPartGroup = {
  name: 'Needles',
  fields: [
    {
      key: 'needle_system', label: 'Needle system', type: 'single_select', appliesTo: 'parts', required: true, filterable: true, highlightRank: 1,
      options: [...options(['dbxk5', 'DBxK5'], ['dbxk5_ses', 'DBxK5 SES'], ['dbx1', 'DBx1']), OTHER],
    },
    { key: 'needle_size', label: 'Needle size', type: 'number', appliesTo: 'parts', unit: 'Nm', min: 55, max: 140, filterable: true, highlightRank: 2 },
  ],
};

/** Schiffli, sequin and chenille machines use other needle systems, so the system is free text. */
const TEXT_NEEDLES: SeedPartGroup = {
  name: 'Needles',
  fields: [
    {
      key: 'needle_system', label: 'Needle system', type: 'text', appliesTo: 'parts', required: true, filterable: true, highlightRank: 1,
      helpText: 'e.g. Schiffli needle system and size as on the packet',
    },
    { key: 'needle_size', label: 'Needle size', type: 'number', appliesTo: 'parts', unit: 'Nm', min: 55, max: 200, filterable: true, highlightRank: 2 },
  ],
};

const boardCode: SeedField = { key: 'board_code', label: 'Board code', type: 'text', appliesTo: 'parts', required: true, highlightRank: 2 };

const motorsAndDrives = (extra: SeedField[] = []) =>
  group('Motors & Drives', [['main_motor', 'Main motor'], ['servo_motor', 'Servo motor'], ['stepper_motor', 'X/Y stepper motor'], ['motor_driver', 'Motor driver']], extra);

const generalSpares = group('General Spares', [['belt', 'Belt'], ['bearing', 'Bearing'], ['gear', 'Gear'], ['spring', 'Spring']]);

/** Multi head and single head share this list. */
const HEAD_MACHINE_PARTS: SeedPartGroup[] = [
  SELECT_NEEDLES,
  group('Needle Bars & Presser Feet', [['needle_bar', 'Needle bar'], ['presser_foot', 'Presser foot'], ['needle_clamp', 'Needle clamp']]),
  group('Rotary Hooks & Bobbin Cases', [['hook', 'Rotary hook'], ['jumbo_hook', 'Jumbo hook'], ['bobbin_case', 'Bobbin case'], ['bobbin', 'Bobbin']]),
  group('Thread Take-ups & Tension', [['take_up_lever', 'Take-up lever'], ['tension_base', 'Tension base'], ['tension_spring', 'Tension spring'], ['thread_guide', 'Thread guide']]),
  group('Trimmers & Cutters', [['moving_knife', 'Moving knife'], ['fixed_knife', 'Fixed knife'], ['trimmer_assembly', 'Trimmer assembly']]),
  group('Frames, Pantograph & Hoops', [['tubular_hoop', 'Tubular hoop'], ['cap_frame', 'Cap frame'], ['border_frame', 'Border frame'], ['pantograph_part', 'Pantograph part']], [
    { key: 'size', label: 'Size', type: 'text', appliesTo: 'parts', helpText: 'e.g. 360 × 500 mm', highlightRank: 2 },
  ]),
  group('Control Boards & Electronics', [['main_board', 'Main board'], ['head_board', 'Head board'], ['operation_panel', 'Operation panel'], ['power_supply', 'Power supply'], ['encoder', 'Encoder']], [boardCode]),
  motorsAndDrives([{ key: 'power', label: 'Power', type: 'number', appliesTo: 'parts', unit: 'W', highlightRank: 2 }]),
  group('Sequin & Cording Devices', [['sequin_device', 'Sequin device'], ['cording_device', 'Cording device'], ['taping_device', 'Taping device']]),
  group('Belts, Bearings & General Spares', [['belt', 'Belt'], ['bearing', 'Bearing'], ['spring', 'Spring'], ['screws_fittings', 'Screws & fittings']]),
];

export const EMBROIDERY_DETAILS: Record<string, MachineTypeDetails> = {
  'Multi Head Embroidery Machine': {
    fields: [heads(1), needlesPerHead(2), maxEmbroideryArea(3), headInterval, controller, attachments(4)],
    partGroups: HEAD_MACHINE_PARTS,
  },
  'Single Head Embroidery Machine': {
    fields: [needlesPerHead(1), maxEmbroideryArea(2), attachments(3), controller],
    partGroups: HEAD_MACHINE_PARTS,
  },
  'Shuttle (Schiffli) Embroidery Machine': {
    fields: [
      {
        key: 'machine_length', label: 'Machine length', type: 'number', appliesTo: 'machines', unit: 'yards', min: 5, max: 25,
        required: true, filterable: true, highlightRank: 1,
      },
      {
        key: 'repeat', label: 'Repeat', type: 'single_select', appliesTo: 'machines', filterable: true, highlightRank: 2,
        options: [...options(['r4_4', '4/4'], ['r6_4', '6/4'], ['r8_4', '8/4']), OTHER],
      },
      controller,
    ],
    partGroups: [
      TEXT_NEEDLES,
      group('Shuttles & Bobbins', [['shuttle', 'Shuttle'], ['bobbin', 'Bobbin'], ['shuttle_spring', 'Shuttle spring']]),
      group('Borers & Cutters', [['borer', 'Borer'], ['cutter', 'Cutter']]),
      group('Pattern Control & Electronics', [['control_board', 'Control board'], ['pattern_drive', 'Pattern drive'], ['sensor', 'Sensor']], [boardCode]),
      motorsAndDrives(),
      group('Frames & Structure', [['frame', 'Frame'], ['rail', 'Rail'], ['stand', 'Stand']]),
      generalSpares,
    ],
  },
  'Sequin Machine': {
    fields: [heads(1), needlesPerHead(2), controller],
    partGroups: [
      group('Sequin Feeders & Cutters', [['sequin_feeder', 'Sequin feeder'], ['sequin_cutter', 'Sequin cutter'], ['reel_holder', 'Sequin reel holder']]),
      TEXT_NEEDLES,
      motorsAndDrives(),
      generalSpares,
    ],
  },
  'Chenille Machine': {
    fields: [heads(1), needlesPerHead(2), controller],
    partGroups: [
      group('Chenille Heads & Loopers', [['chenille_head', 'Chenille head'], ['looper', 'Looper'], ['hook', 'Hook']]),
      TEXT_NEEDLES,
      motorsAndDrives(),
      generalSpares,
    ],
  },
};
