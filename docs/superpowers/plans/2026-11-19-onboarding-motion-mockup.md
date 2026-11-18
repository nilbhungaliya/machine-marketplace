# Onboarding motion mockup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One self-contained HTML mockup of the onboarding screens with the "workshop precision" motion.

**Architecture:** A single page, `docs/mockups/onboarding-motion.html`: a top bar (theme, reduce motion, replay all), then six
phone frames in a responsive grid, each with a caption and a replay button. Drawings are inline SVG; motion is CSS
keyframes on SVG groups, restarted by toggling a `.play` class; a small script handles typing, the OTP bolts, replay and
toggles.

**Tech Stack:** HTML, CSS, inline SVG, vanilla JS; Google Fonts Manrope and JetBrains Mono.

**Spec:** `docs/superpowers/specs/2026-11-19-onboarding-motion-mockup-design.md`

## Global Constraints

- Palette: the `:root` and `[data-theme="dark"]` token blocks of `docs/mockups/src/build-periwinkle-v2.mjs` (lines 775–793), copied verbatim.
- Materials: the `g-steel`, `g-chrome`, `g-ball`, `g-black`, `g-brass` gradients from the same file.
- Copy follows the app (`apps/user-app/screens/welcome.tsx`, `auth/phone.tsx`, `auth/otp.tsx`, onboarding, GST intro) and the v2 mockup.
- No fabric folds, word-by-word rising titles, building shop, stamp or ringing bell (textile's motion).
- `prefers-reduced-motion` and the page's Reduce motion switch show every drawing at its finished frame, still.
- Works at phone width (one column, 16 px gutters, no horizontal scroll).

## Review Focus

- Replay mid-animation restarts cleanly (no stuck half-state).
- OTP: backspace loosens the last bolt; pasting six digits tightens all six; non-digits ignored.
- Dark theme: steel parts stay legible on the dark canvas.
- Reduce motion switched on mid-loop freezes at the finished frame, not a random frame.
- Narrow viewport (360 px): phone frames scale down, nothing overflows.

---

### Task 1: Page shell, Welcome and sign-in screens

**Files:** Create `docs/mockups/onboarding-motion.html`

- [ ] Shell: tokens, fonts, top bar with Light / Dark, Reduce motion, Replay all; phone frame component; caption with the motion's notes.
- [ ] Welcome: exploded hub assembly along axis lines with a seat click, L | R token whose dashed right half scans and snaps in; title revealed from behind a rail mask.
- [ ] Mobile number: odometer-roll digits typed in on loop (and live when the viewer types), dial gauge needle tracks digits filled.
- [ ] Code: flange with six bolts, ratchet tightening per digit (live input), Verify turns the flange a quarter and the seal goes green.

### Task 2: Business, location and GST screens

- [ ] Your business: laser engraving of the name on a steel nameplate (stroke-dash text reveal and a spark), chips riding in on a conveyor with rollers turning.
- [ ] Where are you?: blueprint grid estate map, crane hook lowers the pin, radar sweep pings nearby units.
- [ ] GST: vernier caliper slides along the GSTIN in five segments, readout counts, "within tolerance" tick.

### Task 3: Check and record

- [ ] Check the HTML parses and the script runs without errors (`node` with a DOM-free syntax check of the script block); review against Review Focus by reading the code.
- [ ] Add a row to `docs/mockups/README.md`; commit on a branch `docs/onboarding-motion-mockup`.
