# Seed data

## `pincode-directory.csv.gz`

The post-office directory behind `pincode_offices` and `GET /locations/pincodes/:pincode`,
`GET /locations/nearest-pincode` and `GET /locations/industrial-areas`. Loaded by
`pnpm --filter @mpm/api db:seed:locations` (in a container: `node dist/db/seed-locations.js`, reading `SEED_DATA_DIR`).
Copied byte for byte from the Textile Stock Marketplace project (F1 spec §4.4); the sha256 below is checked against it.

**Status: Interim copy from a third-party mirror, not the official file.**

**Launch prerequisite: Before launch: replace this file with the official directory downloaded with our own data.gov.in access.**

### Source

- **Dataset:** India Post "All India Pincode Directory" on [data.gov.in](https://data.gov.in), Government Open Data
  License - India (GODL-India). Attribution is required. Show this wherever the data is credited:

  > Pincode data: Department of Posts, Ministry of Communications, Government of India, via data.gov.in, under the
  > Government Open Data License - India.

- **This copy came from:** https://raw.githubusercontent.com/dropdevrahul/pincodes-india/main/pincode.csv
- **Mirror commit:** `d817d3e652e8167a70507350d9a8e4acda9113ef` (`main` at the fetch; the last commit touching the file is
  `d26206918dd2fb9f155bfba18de0421bd5fa0ca8`, 2024-05-05)
- **Fetched:** 2026-11-04
- **sha256:** `128f7f7b7973fe81e1d423ee9b8fecea4ce9933ef5297758f526caa388f81967` (this `.gz`),
  `84af12fa29adddedfa9addcf46546000d89d2e2899b2993dc88050fafc8861e2` (the CSV inside it)

### What hasn't been established

The mirror's 157,126 rows equal the total quoted by third-party listings of the dataset, and neither was compared with
the official file. **A matching row count is not evidence of accuracy or completeness.**

### Known defects in this copy

Counted in the file as it stands, before any cleaning:

- 9,045 unusable coordinates
- 2,601 swapped lat/lng pairs
- 1,869 outside India
- 1,168 pincodes spanning several districts
- 5 districts with no usable point (Pherzawl, Siang, Kurung Kumey, Noklak, Kamle)
- inconsistent name case (`AHMADABAD`, `South East`)
- 3 rows with a `9xxxxx` pincode, none a civilian post office: `900056` and `900099` (army post offices) and `999999`
  "Test Office". They are loaded as they are and counted in the pinned pincode total. Check them against the official file.
  (The API tests use `990001`–`990009`, which no row uses.)

What the loader does about them (`apps/api/src/db/seed-locations/`): `cleanPoint` swaps the pairs back and drops a trailing
`-`, which rescues 45 rows and leaves 10,869 with no point. `fillOfficePoints` then gives those, and any point more
than 150 km from its district's median, that median. A district with no point takes its state's median.
`normalizeLocationName` fixes the case. So after a load every office has a point, but many of those points are estimates.

A pincode spanning several districts resolves to the district most of its offices are in, ties to the alphabetically
first (`pincodeDistrict` in `apps/api/src/services/locations/pincode.service.ts`, the one place that rule lives).

### Refresh process

1. Download the official file with the project's own access. Never commit a key.
2. Gzip it to this path and update the source, date and sha256 above.
3. Run `pnpm --filter @mpm/api exec vitest run src/db/seed-locations/parse.test.ts`. Fix the parser if the columns differ,
   check the launch city's spelling (`Surat`, `Gujarat`: the industrial-area seed matches it), and update the pinned
   pincode count on purpose.
4. Compare with the previous file (pincodes added and removed, districts renamed) and check a sample by hand, including
   every launch city. A renamed district needs its `industrial_areas` rows' city renamed to match.
5. Run `pnpm --filter @mpm/api db:seed:locations -- --reset` in each environment. Businesses store the pincode as text,
   so `--reset` only replaces `pincode_offices` and is always allowed.
6. Commit and rebuild the image, which contains the file.
