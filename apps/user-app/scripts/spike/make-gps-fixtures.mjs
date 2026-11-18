#!/usr/bin/env node
// F2 native media spike, host fixtures (plan Task 20 Step 3; spec §6.4, §6.5, R46, R47).
//
// Writes GPS-tagged media into <outDir> (a new, empty directory outside the repo) and proves each one carries its
// location, so the device run (Task 20 Step 4, or the owner's checklist, Task 30) can show that the manipulator and the
// compressor strip it:
//   gps.mp4        20 s, 1920x1080, H.264 + AAC, `location` tag (ISO 6709) via -movflags use_metadata_tags
//   gps.mov        the same as QuickTime: ffmpeg writes `location` as the `©xyz` atom
//   gps-small.mp4  3 s, under 2 MB, same metadata (the compressor's small-file path)
//   gps.jpg        3000x2000 JPEG with an APP1 Exif segment holding a GPS IFD (lat / long rationals)
//
// Usage: node apps/user-app/scripts/spike/make-gps-fixtures.mjs <outDir>
// Needs ffmpeg and ffprobe on PATH. No npm dependencies (exiftool isn't installed on this machine). Exit code 1 when a
// fixture doesn't carry its metadata.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LOCATION = '+21.1702+072.8311/'; // Surat, ISO 6709
const LAT = 21.1702;
const LNG = 72.8311;

const outArg = process.argv[2];
if (!outArg) {
  console.error('usage: node make-gps-fixtures.mjs <outDir>');
  process.exit(2);
}
const out = resolve(outArg);
if (existsSync(out) && readdirSync(out).length > 0) {
  console.error(`refusing: ${out} is not empty (use a new, empty directory)`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const ffprobeFormat = (file) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));

// ─── videos ───
const videoArgs = (seconds, size) => [
  '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=30`,
  '-f', 'lavfi', '-i', `sine=duration=${seconds}`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  '-metadata', `location=${LOCATION}`,
];
ffmpeg([...videoArgs(20, '1920x1080'), '-movflags', 'use_metadata_tags', join(out, 'gps.mp4')]);
ffmpeg([...videoArgs(20, '1920x1080'), '-f', 'mov', join(out, 'gps.mov')]);
ffmpeg([...videoArgs(3, '1280x720'), '-b:v', '2M', '-movflags', 'use_metadata_tags', join(out, 'gps-small.mp4')]);

// ─── photo: a plain JPEG, then an APP1 Exif segment with a GPS IFD inserted after SOI ───
const base = join(out, 'base.jpg');
ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=3000x2000', '-frames:v', '1', '-q:v', '3', base]);

/** Degrees → three unsigned rationals (deg/1, min/1, sec*100/100), big-endian. */
function dmsRationals(value) {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec100 = Math.round((minFloat - min) * 60 * 100);
  const b = Buffer.alloc(24);
  [[deg, 1], [min, 1], [sec100, 100]].forEach(([n, d], i) => {
    b.writeUInt32BE(n, i * 8);
    b.writeUInt32BE(d, i * 8 + 4);
  });
  return b;
}

/** A big-endian TIFF with IFD0 → GPSInfo (0x8825) → GPS IFD (version, lat ref, lat, long ref, long). */
function exifGpsTiff(lat, lng) {
  const IFD0 = 8;
  const IFD0_SIZE = 2 + 12 + 4;
  const GPS = IFD0 + IFD0_SIZE; // 26
  const GPS_ENTRIES = 5;
  const GPS_SIZE = 2 + GPS_ENTRIES * 12 + 4;
  const LAT_AT = GPS + GPS_SIZE; // 92
  const LNG_AT = LAT_AT + 24; // 116
  const tiff = Buffer.alloc(LNG_AT + 24);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(IFD0, 4);
  // IFD0: one entry, GPSInfo (LONG) → GPS IFD offset.
  tiff.writeUInt16BE(1, IFD0);
  tiff.writeUInt16BE(0x8825, IFD0 + 2);
  tiff.writeUInt16BE(4, IFD0 + 4);
  tiff.writeUInt32BE(1, IFD0 + 6);
  tiff.writeUInt32BE(GPS, IFD0 + 10);
  tiff.writeUInt32BE(0, IFD0 + 14);
  // GPS IFD.
  tiff.writeUInt16BE(GPS_ENTRIES, GPS);
  const entry = (i, tag, type, count, write) => {
    const at = GPS + 2 + i * 12;
    tiff.writeUInt16BE(tag, at);
    tiff.writeUInt16BE(type, at + 2);
    tiff.writeUInt32BE(count, at + 4);
    write(at + 8);
  };
  entry(0, 0x0000, 1, 4, (v) => Buffer.from([2, 2, 0, 0]).copy(tiff, v)); // GPSVersionID BYTE[4]
  entry(1, 0x0001, 2, 2, (v) => tiff.write(lat >= 0 ? 'N\0' : 'S\0', v, 'latin1')); // GPSLatitudeRef ASCII
  entry(2, 0x0002, 5, 3, (v) => tiff.writeUInt32BE(LAT_AT, v)); // GPSLatitude RATIONAL[3]
  entry(3, 0x0003, 2, 2, (v) => tiff.write(lng >= 0 ? 'E\0' : 'W\0', v, 'latin1')); // GPSLongitudeRef ASCII
  entry(4, 0x0004, 5, 3, (v) => tiff.writeUInt32BE(LNG_AT, v)); // GPSLongitude RATIONAL[3]
  tiff.writeUInt32BE(0, GPS + 2 + GPS_ENTRIES * 12);
  dmsRationals(lat).copy(tiff, LAT_AT);
  dmsRationals(lng).copy(tiff, LNG_AT);
  return tiff;
}

const jpeg = readFileSync(base);
if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('base.jpg is not a JPEG');
const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifGpsTiff(LAT, LNG)]);
const app1 = Buffer.alloc(4);
app1.writeUInt16BE(0xffe1, 0);
app1.writeUInt16BE(payload.length + 2, 2);
writeFileSync(join(out, 'gps.jpg'), Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]));
unlinkSync(base);

// ─── checks ───

/**
 * The spike's own copy of the server check (spec §6.4; the API's `jpegHasExif` is in `apps/api/src/lib/sniff-media.ts`):
 * walk the header segments in the first 64 KB; an APP1 whose data starts `Exif\0\0` → true. Stops at SOS.
 */
export function jpegHasExif(buf) {
  const head = buf.subarray(0, 65536);
  if (head[0] !== 0xff || head[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= head.length) {
    if (head[i] !== 0xff) return false;
    const marker = head[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xda || marker === 0xd9) return false; // start of scan / end of image
    if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; } // RSTn, no length
    const len = head.readUInt16BE(i + 2);
    if (marker === 0xe1 && head.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') return true;
    i += 2 + len;
  }
  return false;
}

/** Reads the GPS latitude / longitude back out of the first Exif segment (big-endian TIFFs only: what we wrote). */
function readGps(buf) {
  const at = buf.indexOf(Buffer.from('Exif\0\0', 'latin1'));
  if (at < 0) return null;
  const t = buf.subarray(at + 6);
  if (t.toString('latin1', 0, 2) !== 'MM') return null;
  const ifd0 = t.readUInt32BE(4);
  const n0 = t.readUInt16BE(ifd0);
  let gps = null;
  for (let k = 0; k < n0; k++) {
    const e = ifd0 + 2 + k * 12;
    if (t.readUInt16BE(e) === 0x8825) gps = t.readUInt32BE(e + 8);
  }
  if (gps == null) return null;
  const n = t.readUInt16BE(gps);
  const vals = {};
  for (let k = 0; k < n; k++) {
    const e = gps + 2 + k * 12;
    const tag = t.readUInt16BE(e);
    if (tag === 2 || tag === 4) {
      const off = t.readUInt32BE(e + 8);
      const r = (j) => t.readUInt32BE(off + j * 8) / t.readUInt32BE(off + j * 8 + 4);
      vals[tag] = r(0) + r(1) / 60 + r(2) / 3600;
    }
  }
  return { lat: vals[2], lng: vals[4] };
}

const results = [];
let failed = false;
for (const name of ['gps.mp4', 'gps.mov', 'gps-small.mp4']) {
  const file = join(out, name);
  const probe = ffprobeFormat(file);
  const tags = probe.format.tags ?? {};
  const location = tags.location ?? tags['location-eng'] ?? tags['com.apple.quicktime.location.ISO6709'] ?? null;
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const row = {
    file: name,
    bytes: statSync(file).size,
    formatName: probe.format.format_name,
    majorBrand: tags.major_brand ?? null,
    durationS: Number(probe.format.duration),
    video: v ? `${v.codec_name} ${v.width}x${v.height}` : null,
    audio: probe.streams.some((s) => s.codec_type === 'audio'),
    location,
  };
  if (!location) failed = true;
  results.push(row);
}
{
  const buf = readFileSync(join(out, 'gps.jpg'));
  const gps = readGps(buf);
  const row = { file: 'gps.jpg', bytes: buf.length, jpegHasExif: jpegHasExif(buf), gps };
  if (!row.jpegHasExif || !gps || Math.abs(gps.lat - LAT) > 1e-3 || Math.abs(gps.lng - LNG) > 1e-3) failed = true;
  results.push(row);
}
if (statSync(join(out, 'gps-small.mp4')).size >= 2 * 1024 * 1024) failed = true;

console.log(JSON.stringify({ outDir: out, results, ok: !failed }, null, 2));
process.exit(failed ? 1 : 0);
