# Apple Voice Memos direct-reference QA

Date: 2026-07-20

Reference: supplied 1206 × 2622 iPhone recording

Implementation viewport: 390 × 844 CSS px

## Directly measured reference behavior

- The gesture is progressive: Delete becomes visible first, Move second, More last.
- The three actions share one vertical center with the active record; icon and label form
  one centered group rather than floating at the row top.
- More and Move use compact pills. Delete stretches horizontally during continued
  leftward overscroll while its right edge stays anchored.
- The active row's upper and lower dividers lose opacity continuously with the gesture.
- Main record text is visibly heavier than its metadata. Metadata and time are muted by
  colour without becoming hairline text.
- Top controls are 44–48 pt optical targets and use complete circles or pills.

## Final implementation geometry

- System font stack: `-apple-system`, BlinkMacSystemFont, SF Pro Text/Display,
  PingFang SC, Hiragino Sans, Yu Gothic, Segoe UI, sans-serif.
- Page title: 34/41, weight 700.
- Navigation title: 17/22, weight 600.
- Row title: 17/22, weight 600 on user content.
- Secondary copy: 15/21, weight 500; time uses tabular numerals at weight 500.
- Shopping two-line row: 72 px.
- Swipe action column: 72 px; open rail: 224 px.
- Action pill: 72 × 46 px; icon: 22 px, 2 px round stroke.
- Action group: 68 px high and centered inside the 72 px row.
- Delete overscroll stretch: up to 1.46×, anchored to the right edge.
- Top icon controls: 48 × 48 px, 22 px round-line icon.
- Task toolbar: 358 × 60 px; side controls 48 px circles; inner scope 232 × 48 px pill.
- Bottom dock: 334 × 66 px; shared selected surface remains one persistent pill.
- Radius vocabulary: pill 999 px; small/medium/large cards 20/24/28 px; panels and
  sheets 32 px; circle 50%.

## Gesture mapping

One live pointer distance is written to CSS custom properties without React rerenders:

- Delete progress: 0.04–0.34.
- Secondary action progress: 0.28–0.66.
- Leading action progress: 0.56–0.92.
- Divider opacity: `1 - swipeProgress × 1.18`.
- Delete overscroll: final 18 px rubber-band range mapped to horizontal pill stretch.

At tested drag distances the divider opacity changed from 0.842 (30 px) to 0.568
(82 px), 0.220 (148 px), then 0 at the full 224 px reveal. A 242 px drag stretched
Delete from 72 px to 79.29 px while preserving its right coordinate. Reversing a
142 px gesture back to 12 px closed to transform `none`, proving interruption does not
leave a stale visual layer.

## Combined visual inspection

The 1206 × 2622 recording frame was downscaled to the same 390 px viewport width and
placed beside the implementation. A 50% overlay and five-stage gesture contact sheet
were also inspected:

- `apple-voice-shopping-side-by-side.png`
- `apple-voice-shopping-overlay.png`
- `apple-swipe-final-sequence.png`
- `final-route-radius-audit.png`

The comparison confirmed that action controls now share the active row center, labels
sit under their pills, the destructive action is visually dominant, row typography is
heavier, and the task toolbar/primary switches use complete pill geometry.

## Functional and stability checks

- `npm run lint`: passed.
- `npm test -- --run`: 22 files, 116 tests passed.
- `npm run build`: passed; PWA generated with 46 precache entries.
- Direct gesture at five distances: passed.
- Reverse/cancel gesture: passed; no open state or transform remained.
- Reduced motion: direct manipulation remained available and the row settled without
  the staged ornamental transition.
- Shopping feedback no longer changes document flow: row top stayed exactly 282 px
  before and after opening the action rail. The existing undo callback is now displayed
  as a fixed pill above the bottom dock.
- Six primary routes rendered at 390 × 844; icon controls, segmented controls, picker
  rows, inputs and dock surfaces use the shared circle/pill/card tokens.
- Task, shopping and generic swipe callbacks were not changed.

## Remaining physical-device checks

- Automation used local Chromium at 390 × 844, not a physical iPhone. Safari glyph
  rasterization, Home Screen PWA safe-area compositing and touch velocity must still be
  confirmed on the user's device.
- The reference uses Apple proprietary filled glyph geometry. The app intentionally
  retains its existing rounded line icon family, so glyph silhouettes are not pixel
  identical.
- Content and page purpose differ from Voice Memos, so the full-page overlay is used to
  compare scale and visual hierarchy, not to claim identical content coordinates.
