import type { CategoryIcon } from '@mpm/shared-types';
import { PART_ITEMS, PROCESS_PART_GROUPS } from './cleaning.js';
import { EMBROIDERY_DETAILS, type MachineTypeDetails } from './embroidery.js';
import type { SeedCategory, SeedMachineType, SeedPartGroup } from './types.js';
import { WATER_JET_DETAILS } from './water-jet.js';

// The machine catalogue tree taken from Fibre2Fashion Machinery (spec §4.1): F2F's sub-categories reduced to 10 machine
// categories, and F2F's product types (cleaned in cleaning.ts) placed under them as machine types. A draft the client
// reviews in the export.

/**
 * Canonical machine-type names per category, in display order. Names are F2F's with each word capitalised and typos
 * fixed; F2F's other spellings of the same machine are in cleaning.ts `MERGED`.
 */
export const PLACEMENT: Record<string, string[]> = {
  Spinning: [
    'Bale Opener',
    'Bale Cutter',
    'Blow Room Line',
    'Opening & Cleaning Machine',
    'Blending Machine',
    'Hopper Feeder',
    'Carding Machine',
    'Card Grinding & Polishing Machine',
    'Card Clothing Mounting Machine',
    'Card Winding Machine',
    'Lapper',
    'Comber',
    'Draw Frame',
    'Gill Box',
    'Roving Frame',
    'Ring Spinning Frame',
    'Automatic Doffing and Piecing Systems',
    'Rotor Spinning Machine',
    'Air Jet Spinning Machine',
    'Friction Spinning Machine',
    'Fancy Yarn Spinning Machine',
    'Woollen & Worsted Card',
    'Woollen Ring Spinning Frame',
    'Wool Processing Line',
    'Wool Scouring Line',
    'Cotton Wool Processing Line',
    'Jute Processing Machine',
    'Textile Recycling Line',
    'Tearing Machine',
    'Melt Spinning Line',
    'Dry Spinning Line',
    'Wet Spinning Line',
    'Electro-Spinning Machine',
    'Extrusion Line',
    'Polymerisers',
    'Stretch Breaking Machine',
    'Crimping Machine',
    'Texturising Machine',
    'Air Texturing Machine',
    'Bulking Machine',
    'Air Covering Machine',
    'Covering Machine',
    'Autoconer',
    'Cone & Cheese Winder',
    'Doubling Machine',
    'Two for One Twister (TFO)',
    'Twisting Machine',
    'Ring Twisting Machine',
    'Reeling Machine',
    'Balling Winder',
    'Yarn Singeing Machine',
    'Yarn Conditioning Machine',
    'Autoclave',
  ],
  Weaving: [
    'Water Jet Loom',
    'Rapier Loom',
    'Air Jet Loom',
    'Projectile Loom',
    'Jacquard Loom',
    'Jacquard Machine',
    'Automatic Loom',
    'Power Loom (Non-Automatic)',
    'Multi Phase Weaving Machine',
    'Circular Loom',
    'Carpet Loom',
    'Carpet Making Machine',
    'Terry Weaving Machine',
    'Label Loom',
    'Needle Loom',
    'Ribbon Basing Machine',
    'Sample Weaving Machine',
    'Weft Insertion Machine',
    'Tufting Machine',
    'Direct Warping Machine',
    'Sectional Warping Machine',
    'Sizing Machine',
    'Beaming Machine',
    'Warp Tying & Knotting Machine',
    'Warp & Weft Winding Machine',
    'Batcher',
    'Non-woven Line',
    'Needle Punching Line',
    'Bonding Machine',
    'Braiding Machine',
  ],
  Knitting: [
    'Circular Knitting Machine',
    'Flat Knitting Machine',
    'Single Cylinder Knitting Machine',
    'Double Cylinder Knitting Machine',
    'Socks Knitting Machine',
    'Hosiery Machine',
    'Warp Knitting Machine',
    'Raschel Machine',
    'Tricot Machine',
    'Crochet Knitting Machine',
    'Lace Machine',
    'Boarding Machine for Knitwear',
  ],
  Dyeing: [
    'Jet Dyeing Machine',
    'Overflow Dyeing Machine',
    'Jigger Dyeing Machine',
    'Hank Dyeing Machine',
    'Centrifugal Dyeing Machine',
    'Knitwear and Hosiery Dyeing Machine',
    'Continuous Dyeing Range',
    'Dyeing Apparatus',
    'Dyeing Auxiliary Machine',
    'Package Dryer',
    'Bleaching Range',
    'Desizing Machine',
    'Scouring Machine',
    'Singeing Machine',
    'Mercerising Range',
    'Open-Width Washing Range',
    'Padding Mangle',
    'Steaming Machine',
    'Continuous Steamer & Dryer',
    'Colour Dispensing System',
    'Colour Mixing Machine',
    'Dosing Machine',
    'Dipping Machine',
  ],
  'Printing & Finishing': [
    'Rotary Screen Printing Machine',
    'Flat Screen Printing Machine',
    'Digital Textile Printer',
    'Heat Transfer Machine',
    'Label Printing Machine',
    'Engraving System for Rotary Screens',
    'Stenter Machine',
    'Compacting Machine',
    'Sanforizing Machine',
    'Calender',
    'Raising Machine',
    'Emerizing & Sueding Machine',
    'Shearing Machine',
    'Brushing Machine',
    'Embossing Machine',
    'Flocking Machine',
    'Coating & Laminating Machine',
    'Decatising Machine',
    'Crabbing Machine',
    'Felting Machine',
    'Finish Breaking Machine',
    'Polishing Machine',
    'Curing Oven',
    'Fabric Dryer',
    'Drum Drying Machine',
    'High Frequency Dryer',
    'Infrared Dryer',
    'Fabric Measuring, Rolling and Folding Machine',
    'Crossfolder',
    'Slitting Machine',
    'Wadding Machine',
  ],
  'Testing & Inspection': [
    'Fabric Inspection Machine',
    'Fabric Testing Machine',
    'Yarn Testing Machine',
    'Fibre Testing Machine',
    'Colour Measuring Instrument',
    'Fault Detection System',
    'Online Monitoring System',
    'Needle Detector Machine',
    'Textile Scale',
  ],
  'Sewing, Embroidery & Garments': [
    'Multi Head Embroidery Machine',
    'Single Head Embroidery Machine',
    'Shuttle (Schiffli) Embroidery Machine',
    'Sequin Machine',
    'Chenille Machine',
    'Industrial Sewing Machine',
    'Household Sewing Machine',
    'Overlock Machine',
    'Interlocking Machine',
    'Multifunction Sewing Machine',
    'Denim Sewing Machine',
    'Heavy Fabrics Sewing Machine',
    'End-to-End Sewing Machine',
    'Bag Stitching Machine',
    'Seaming Machine',
    'Hemming Machine',
    'Buttonhole Machine',
    'Button Attaching Machine',
    'Button Covering Machine',
    'Button Making Machine',
    'Pocket Attaching Machine',
    'Pocket Welting Machine',
    'Taping Machine',
    'Fusing Machine',
    'Garment Cutting Machine',
    'Fabric Spreading Machine',
    'Cloth Unrolling Machine',
    'Marking Machine',
    'Pleating Machine',
    'Quilting and Mattress Machine',
    'Pillow Filling Machine',
    'Fringeing Machine',
    'Stapling Machine',
    'Trimming Machine',
    'Garment Folding Machine',
    'Sewing Thread Winding Machine',
  ],
  Laundry: [
    'Industrial Washing Machine',
    'Hydro Extractor',
    'Tumble Dryer',
    'Dry Cleaning Machine',
    'Ironing & Pressing Machine',
    'Laser Machine for Garments',
    'Spraying Machine',
  ],
  'Leather & Footwear Machinery': [
    'Leather Brushing Machine',
    'Leather Cutting Machine',
    'Leather Drying Machine',
    'Leather Dyeing Machine',
    'Leather Finishing Machine',
    'Leather Marking Machine',
    'Leather Plating & Ironing Machine',
    'Leather Polishing Machine',
    'Leather Pressing Machine',
    'Leather Printing Machine',
    'Leather Trimming Machine',
    'Fleshing Machine',
    'Splitting Machine',
    'Buffing Machine',
    'Milling Machine',
    'Vulcanizing Machine',
    'Perforating Machine',
    'Punching Machine',
    'Shoe Making Machine',
    'Multifunction Shoe Machine',
    'Footwear Sewing Machine',
    'Backpart Moulding Machine',
    'Counter Moulding Machine',
    'Insole Moulding Machine',
    'Cementing Machine',
    'Heel Nailing Machine',
    'Sole Jointing & Electing Moulding Machine',
    'EVA Foaming Injection Moulding Machine',
    'Plastic Shoe Automatic Injection Moulding Machine',
    'Turning Machine',
    'Leather and Shoe Auxiliary Machine',
  ],
  'Equipment & Accessories': [
    'Humidification Plant',
    'Air Conditioning Plant',
    'Boiler',
    'Compressor',
    'Generator',
    'Effluent Treatment Plant',
    'Conveying System',
    'Baling Press',
    'Bale Wrapping System',
    'Packing Machine',
    'Trolley',
    'Tank',
    'A-Frame',
    'Mixer',
    'Grinding Machine',
    'Adhesive Machine',
  ],
};

const ICONS: Record<string, CategoryIcon> = {
  Spinning: 'cog',
  Weaving: 'layers',
  Knitting: 'shirt',
  Dyeing: 'droplets',
  'Printing & Finishing': 'printer',
  'Testing & Inspection': 'microscope',
  'Sewing, Embroidery & Garments': 'scissors',
  Laundry: 'washing-machine',
  'Leather & Footwear Machinery': 'footprints',
  'Equipment & Accessories': 'wrench',
};

/** Full settings, fields and part groups for some machine types, merged in by machine-type name. */
const DETAILS: Record<string, MachineTypeDetails> = { ...EMBROIDERY_DETAILS, ...WATER_JET_DETAILS };

const nameOf = (node: SeedPartGroup) => (typeof node === 'string' ? node : node.name);

/** Part groups from F2F's spare-part items for one machine type, in PART_ITEMS order, each name once. */
function partItemGroups(machineType: string): string[] {
  const out: string[] = [];
  for (const { partGroup, machineTypes } of Object.values(PART_ITEMS)) {
    if (machineTypes.includes(machineType) && !out.includes(partGroup)) out.push(partGroup);
  }
  return out;
}

/** F2F's process-wide part groups that cover this machine type. */
function processGroups(category: string, machineType: string): string[] {
  return Object.values(PROCESS_PART_GROUPS)
    .filter((p) => p.categories.includes(category) && !p.except.includes(machineType))
    .map((p) => p.partGroup);
}

/** A machine type with its detailed part groups first, then F2F part items, then the process-wide group last. */
function machineType(category: string, name: string): SeedMachineType {
  const details = DETAILS[name] ?? {};
  const partGroups: SeedPartGroup[] = [...(details.partGroups ?? [])];
  for (const group of [...partItemGroups(name), ...processGroups(category, name)]) {
    if (!partGroups.some((pg) => nameOf(pg) === group)) partGroups.push(group);
  }
  return { name, ...details, partGroups };
}

for (const name of Object.keys(DETAILS)) {
  if (!Object.values(PLACEMENT).some((types) => types.includes(name))) throw new Error(`Details for unplaced machine type "${name}"`);
}

export const CATEGORIES: SeedCategory[] = Object.entries(PLACEMENT).map(([name, types]) => ({
  name,
  icon: ICONS[name]!,
  machineTypes: types.map((type) => machineType(name, type)),
}));
