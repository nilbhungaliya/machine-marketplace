import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanOfficeName, cleanPoint, normalizeLocationName, parseCsv, parseDirectory } from './parse.js';

const HEADER = 'CircleName,RegionName,DivisionName,OfficeName,Pincode,OfficeType,Delivery,District,StateName,Latitude,Longitude';
const row = (office: string, pincode: string, district = 'SURAT', state = 'GUJARAT', lat = '21.17', lng = '72.83') =>
  `Gujarat Circle,Surat Region,Surat Division,${office},${pincode},SO,Delivery,${district},${state},${lat},${lng}`;

describe('parseCsv', () => {
  it('reads quoted fields, embedded commas, doubled quotes and either line ending', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a line break inside quotes and skips a blank line', () => {
    expect(parseCsv('"a\nb",c\n\nd,e')).toEqual([
      ['a\nb', 'c'],
      ['d', 'e'],
    ]);
  });
});

describe('normalizeLocationName', () => {
  it.each([
    ['AHMADABAD', 'Ahmadabad'],
    ['South East', 'South East'],
    ['  NEW   DELHI ', 'New Delhi'],
    ['KAIMUR (BHABUA)', 'Kaimur (Bhabua)'],
    ['JANJGIR-CHAMPA', 'Janjgir-Champa'],
    ['DAMAN &DIU', 'Daman &Diu'],
    ['S.A.S Nagar', 'S.A.S Nagar'],
    ['24 PARAGANAS SOUTH', '24 Paraganas South'],
  ])('%s becomes %s', (input, expected) => {
    expect(normalizeLocationName(input)).toBe(expected);
  });
});

describe('cleanOfficeName', () => {
  it.each([
    ['Pandesara S.O', 'Pandesara'],
    ['Kosad B.O.', 'Kosad'],
    ['Parliament House GPO', 'Parliament House'],
    ['Delhi G.P.O.', 'Delhi'],
    ['Nanpura H.O', 'Nanpura'],
    ['Nanpura HO', 'Nanpura'],
    ['NAGRAH BO', 'NAGRAH'],
    ['Peddakotla so', 'Peddakotla'],
    ['Rampur PO', 'Rampur'],
  ])('%s becomes %s', (input, expected) => {
    expect(cleanOfficeName(input)).toBe(expected);
  });

  it.each(['Sopo', 'Abhiya bazarBO', 'Chinnabeeravalli', 'BO'])('leaves %s alone', (input) => {
    expect(cleanOfficeName(input)).toBe(input);
  });
});

describe('cleanPoint', () => {
  it('passes a good pair, trimmed', () => {
    expect(cleanPoint(' 21.1006352 ', '81.0350276 ')).toEqual({ lat: 21.1006352, lng: 81.0350276 });
  });

  it('drops a trailing minus and swaps a swapped pair back', () => {
    expect(cleanPoint('83.9610540-', '21.1')).toEqual({ lat: 21.1, lng: 83.961054 });
  });

  it.each([
    ['NA', 'NA'],
    ['21.1', 'NA'],
    ['21.9161 N', '84.0464 E'],
    ['', ''],
    ['2', '200'],
    ['40.7395990', '73.9883650-'], // outside India either way round
    ['21.1', '-72.8'],
  ])('refuses %s, %s', (lat, lng) => {
    expect(cleanPoint(lat, lng)).toBeNull();
  });
});

describe('parseDirectory', () => {
  it('maps the columns by name and cleans each value', () => {
    expect(parseDirectory(`${HEADER}\n${row('Pandesara S.O', '394221')}\n`)).toEqual([
      { pincode: '394221', officeName: 'Pandesara', district: 'Surat', state: 'Gujarat', lat: 21.17, lng: 72.83 },
    ]);
  });

  it('accepts the columns in any order, with a byte-order mark and quotes', () => {
    const csv = '﻿"Pincode","StateName","District","OfficeName","Latitude","Longitude"\n"394221","GUJARAT","SURAT","Kosad, Old B.O","NA","NA"\n';
    expect(parseDirectory(csv)).toEqual([
      { pincode: '394221', officeName: 'Kosad, Old', district: 'Surat', state: 'Gujarat', lat: null, lng: null },
    ]);
  });

  it('puts an all-caps office name in title case and keeps an acronym in a mixed one', () => {
    const rows = parseDirectory(`${HEADER}\n${row('PALVANCHA B.O', '394221')}\n${row('Kathwada GIDC S.O', '394222')}\n`);
    expect(rows.map((r) => r.officeName)).toEqual(['Palvancha', 'Kathwada GIDC']);
  });

  it('yields one row for a repeated pincode and office, even with different suffixes and case', () => {
    const rows = parseDirectory(`${HEADER}\n${row('Kosad B.O', '394221')}\n${row('Kosad B.O', '394221')}\n${row('KOSAD BO', '394221')}\n`);
    expect(rows).toHaveLength(1);
  });

  it('keeps the same office name in another pincode or district', () => {
    const rows = parseDirectory(`${HEADER}\n${row('Kosad B.O', '394221')}\n${row('Kosad B.O', '394222')}\n${row('Kosad B.O', '394221', 'TAPI')}\n`);
    expect(rows).toHaveLength(3);
  });

  it.each(['District', 'Pincode', 'OfficeName', 'StateName', 'Latitude', 'Longitude'])('throws on a CSV without %s, naming it', (column) => {
    const header = HEADER.split(',').map((c) => (c === column ? 'Other' : c)).join(',');
    expect(() => parseDirectory(`${header}\n${row('Kosad B.O', '394221')}\n`)).toThrow(column);
  });

  it.each(['12345', '012345', '39422A', ''])('throws on the pincode "%s", naming its line', (pincode) => {
    expect(() => parseDirectory(`${HEADER}\n${row('Kosad B.O', '394221')}\n${row('Rampur B.O', pincode)}\n`)).toThrow(/line 3/);
  });

  it('throws on a row with no district', () => {
    expect(() => parseDirectory(`${HEADER}\n${row('Kosad B.O', '394221', ' ')}\n`)).toThrow(/line 2/);
  });
});

describe('the committed snapshot', () => {
  const file = resolve(fileURLToPath(import.meta.url), '../../../../../../infra/seed/pincode-directory.csv.gz');
  const rows = parseDirectory(gunzipSync(readFileSync(file)).toString('utf8'));

  // Pins the snapshot against accidental change. It says nothing about accuracy: see infra/seed/README.md.
  it('has exactly 19,300 distinct pincodes', () => {
    expect(new Set(rows.map((r) => r.pincode)).size).toBe(19300);
  });

  // The industrial-area seed (Surat, Gujarat) matches areas to the pincode's district and state by these spellings.
  it('spells the launch city as the industrial-area seed does: Surat, Gujarat', () => {
    expect(rows.some((r) => r.district === 'Surat' && r.state === 'Gujarat')).toBe(true);
  });
});
