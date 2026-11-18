# Onboarding motion mockup ("workshop precision"): design

Date: 2026-11-19. Short design (a mockup only, no app code). Approved by the owner in conversation.

## Why

The owner wants the machine parts app's onboarding (Welcome, Mobile number, Code, Your business, Where are you?, GST) to
have motion as polished as the textile app's onboarding, but its own: "do not do same, try different and unique things".

## Goals

- One self-contained mockup, `docs/mockups/onboarding-motion.html`, in the Periwinkle v2 look (palette tokens from
  `src/build-periwinkle-v2.mjs`, Manrope, JetBrains Mono, parts in the same steel / chrome / brass materials).
- A mechanical motion language: parts glide along axis lines and seat with a small click, ratchet steps, guide-rail
  slides, precise easing with a tiny settle. Each screen tells the app's story in its drawing.
- Interactive: type the code, replay each screen, light / dark, reduce motion.

## Non-goals and anti-goals

- Nothing from textile's motion: no fabric folds, no word-by-word rising titles, no "shop builds itself", stamp or
  ringing bell.
- No change to the app; copy and screens follow the current flow and the Periwinkle v2 mockup.
- No bounce-heavy or cartoon motion; no confetti.

## Screens and their motion

| Screen | Motion |
|---|---|
| Welcome | Exploded view of a wheel hub: bearing, gear and bolts glide in along dashed axis lines and seat with a click; the left half of an L \| R token is solid, the right half a dashed blueprint outline that scans, finds its match and snaps in. Title slides out from behind a guide-rail mask. |
| Mobile number | Digits roll into place like an odometer counter; a dial gauge needle sweeps as the number fills. |
| Code (OTP) | Six bolts on a flange; each digit typed tightens one bolt with a ratchet tick. On Verify the flange turns a quarter and a seal turns green. |
| Your business | A laser line engraves the business name onto a steel nameplate; the activity and machine chips ride in on a conveyor. |
| Where are you? | Blueprint grid map of an industrial estate; a crane hook lowers the pin onto the plot; a radar sweep marks nearby units. |
| GST | A vernier caliper slides over the 15-character GSTIN, reads it segment by segment, and shows "within tolerance". |

## Approaches

Considered: (a) one HTML page with inline SVG and CSS keyframes, a little JS for typing, replay and toggles;
(b) a generator script like `build-periwinkle-v2.mjs`; (c) Lottie files. Chosen: (a). A one-off motion mockup needs no
generator, and Lottie adds a tool and a dependency. CSS transforms on SVG groups map to the app's layered
`Animated.View` approach if built later.

## Left to the builder

Exact geometry, timings, the layout of the page around the phones.
