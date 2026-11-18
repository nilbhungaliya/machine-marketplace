# Spike: F2 native media (photos, video, upload)

Plan `docs/superpowers/plans/2026-11-18-f2-f3-listings.md` Task 20; spec §6.4, §6.5, R46, R47, amendment 3.
Run 2026-11-18 by lane L4 on Windows 11 (no phone, no emulator).

## Result

**Installed and bundles; device checks pending (owner checklist, Task 30).** Video stays **off**.

| Check | State |
|---|---|
| Packages installed (C0) and config plugins in `app.json` | Done |
| `CI=1 npx expo export --platform android` with the native modules imported | **Passes** |
| Host fixtures with GPS metadata, proven by `ffprobe` and our own JPEG EXIF reader | **Pass** |
| Device run: manipulator strips EXIF, compressor drops `location`, H.264 ≤ 1280, poster, playback, streamed PUT | **Not run.** `adb devices` lists nothing and `emulator -list-avds` lists no AVD |

## Versions

| Package | Version |
|---|---|
| expo-image-manipulator | 14.0.8 |
| expo-video | 3.0.16 |
| expo-video-thumbnails | 10.0.8 |
| react-native-compressor | 2.0.6 |
| react-native-nitro-modules | 0.37.2 |
| expo-file-system (legacy API for `createUploadTask`) | 19.0.24 |

Plugins in `app.json`: `expo-video`, `react-native-compressor`, and `expo-image-picker` with `cameraPermission`,
`photosPermission` and `microphonePermission`.

## What ran

### Bundle

The spike screen (`screens/dev/media-spike.tsx`, behind a `__DEV__` stack entry) imported `expo-image-manipulator`,
`expo-video` (`useVideoPlayer`, `VideoView`), `expo-video-thumbnails`, `react-native-compressor` (`Video`,
`getVideoMetaData`) and `expo-file-system/legacy` (`createUploadTask`), plus the app's `lib/media-device.ts`.

```
cd apps/user-app
CI=1 npx expo export --platform android --output-dir <temp dir outside the repo>
```

Exit 0; one Hermes bundle (9.94 MB). Its bytecode names `Compressor`, `ExpoVideo`, `ExpoVideoThumbnails`,
`ExpoImageManipulator`, `createUploadTask` and `NitroModules`, so the modules were bundled, not tree-shaken away. The
export was deleted, then the screen and its navigation entry were removed from the app (source kept, below).

A JS bundle does not prove the native side builds: `pnpm android` (a dev-client build with the compressor's Nitro
module) is the first step of the device run.

### Host fixtures

```
node apps/user-app/scripts/spike/make-gps-fixtures.mjs <new empty dir>
```

The script refuses a non-empty directory, makes the files with `ffmpeg`, writes the JPEG's `APP1 Exif` segment itself
(big-endian TIFF, IFD0 → GPS IFD with latitude / longitude rationals), and checks every file (`ffprobe`, and its own
`jpegHasExif` / GPS reader, which walks the JPEG segments up to SOS). It prints JSON and exits 1 if a check fails.

| File | Size | Check |
|---|---|---|
| `gps.mp4` | 674 898 B | `isom`, H.264 1920×1080, AAC, 20 s; `location` = `+21.1702+072.8311/` (an `mdta` key, written by `-movflags use_metadata_tags`) |
| `gps.mov` | 674 855 B | `qt  `; `location` = `+21.1702+072.8311/`; `©xyz` atom found at byte 674 829 |
| `gps-small.mp4` | 233 485 B | H.264 1280×720, 3 s; `location` present |
| `gps.jpg` | 205 687 B | 3000×2000; `jpegHasExif` true; GPS reads back 21.1702 N, 72.8311 E |

Result: `ok: true`. Each fixture carries the metadata that the app pipeline must strip.

## Decision

- **Video off.** The app's `videoUploadEnabled()` (`apps/user-app/lib/media-prepare.ts`) is true only when all of
  these hold: `LISTING_VIDEO_UPLOAD_ENABLED` (shared-types) **and** `VIDEO_SPIKE_PASSED` (same file, now `false`)
  **and** `Platform.OS === 'android'`. The app offers no video today.
- **Integration must flip the shared constant.** Lane L4 may not edit shared-types, and
  `LISTING_VIDEO_UPLOAD_ENABLED` is still `true` in `packages/shared-types/src/index.ts`. Step 1 of the plan wants it
  `false` so the API refuses video presign / attach as well. **At integration: set it to `false` and rebuild
  shared-types.**
- Photos are not blocked: whether the manipulator's JPEG re-encode drops EXIF is still unproven on a device. The API's
  `MEDIA_METADATA` sniff refuses a photo that keeps EXIF, so a failure would show up as a refused upload, not as a leak.

## Owner's next steps (Task 30, first item)

1. Attach an Android phone (USB debugging on) or create and start an AVD (Android Studio → Device Manager); check that
   `adb devices` lists it.
2. Restore the spike screen: follow the header of `apps/user-app/scripts/spike/media-spike.tsx.txt` (copy it to
   `apps/user-app/screens/dev/media-spike.tsx`, add the `__DEV__` stack entry and a `__DEV__` button to open it).
3. `pnpm android` (new dev client: the compressor and Nitro modules are native). Record success or the build error.
4. Make fixtures in a new empty directory and copy them into the app:
   ```
   node apps/user-app/scripts/spike/make-gps-fixtures.mjs <dir>
   adb push <dir>/. /data/local/tmp/spike/
   adb shell run-as com.machineparts.app mkdir -p files/spike
   adb shell run-as com.machineparts.app cp /data/local/tmp/spike/<file> files/spike/   (each of the four)
   ```
5. Upload target: with R2 keys, set `EXPO_PUBLIC_SPIKE_UPLOAD_URL` to a presigned PUT (video/mp4, the exact size of
   `gps-small.mp4`). Without them: `node apps/user-app/scripts/spike/upload-sink.mjs` on the host plus
   `adb reverse tcp:8099 tcp:8099`.
6. On the screen: **Run media checks**, then **Play public MP4**. Pull the outputs with
   `adb exec-out run-as com.machineparts.app cat files/spike/out/<f> > <f>`: `photo.jpg`, `poster.jpg`,
   `gps-mp4-out.mp4`, `gps-mov-out.mp4`, `gps-small-mp4-out.mp4`.
7. Check on the host:
   - each video output: `ffprobe -v quiet -show_format -show_streams <f>` shows codec `h264`, long edge ≤ 1280 and
     **no `location` tag** (the fixture has one);
   - `photo.jpg`: `jpegHasExif` false (import it from `make-gps-fixtures.mjs`);
   - `poster.jpg` exists; the compressor's `getVideoMetaData` reported a duration; the upload logged progress events
     and status 200 (the sink also prints bytes and content type).
8. Decide (plan Task 20 Step 5):
   - **All pass** → set `LISTING_VIDEO_UPLOAD_ENABLED = true` in shared-types, rebuild it, and set
     `VIDEO_SPIKE_PASSED = true` in `apps/user-app/lib/media-prepare.ts`. iOS stays off until its own checks.
   - **Compressor doesn't build, or `location` survives** → video stays off; remove `react-native-compressor` and
     `react-native-nitro-modules`, then choose (a) raw uploads with their location metadata and the HEVC / MOV risk, or
     (b) another metadata-free path. No other library without the owner.
   - **Manipulator output keeps EXIF** → photos fail with `MEDIA_METADATA`; this blocks the sell flow (Batch 8).
9. Remove the spike screen and its navigation entry again; record the results here and in `docs/PROJECT_STATUS.md`.

## Files

- `apps/user-app/scripts/spike/make-gps-fixtures.mjs`: host fixtures and their checks.
- `apps/user-app/scripts/spike/media-spike.tsx.txt`: the spike screen's source (not compiled), with restore steps.
- `apps/user-app/scripts/spike/upload-sink.mjs`: the local PUT target used when R2 isn't set.
- `apps/user-app/lib/media-prepare.ts`: `VIDEO_SPIKE_PASSED`, `videoUploadEnabled()`, the targets the screen uses.
- `apps/user-app/lib/media-device.ts`: the production prepare / upload code (same APIs the screen calls).
