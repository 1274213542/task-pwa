# Apple reference calibration QA

Date: 2026-07-20

Implementation viewport: 390 × 844 CSS px

Source crop: 1206 × 407 px

## Measured source rules

- The supplied swipe-action crop uses three equal action columns.
- Each visible action surface is a full pill, approximately 1.6:1 width to height.
- Neutral, move and destructive pills are separated by a narrow, regular gap.
- The icon is optically centered inside the pill; the text label is centered below it,
  rather than being placed inside the colored surface.
- All three labels use the same secondary gray. Danger is expressed by the pill,
  not by a second red label.
- The latest crop provides no page header, content-card or bottom-navigation pixels;
  those areas were normalized against the earlier full-screen Apple system references
  and the project's existing 390 × 844 mobile states rather than falsely claiming a
  full-page pixel overlay from this crop.

## Implemented geometry

- Swipe action column: 68 × 64 px.
- Colored pill: 68 × 44 px, radius 22 px.
- Icon: 20 px, one Phosphor round-line family, 1.9 stroke width.
- Label: 13/17 px, medium system weight, 3 px below the pill.
- Bottom dock: 334 × 66 px at 390 px viewport, x=28, bottom=12 px.
- Shared active dock bubble: 65.1875 × 58 px; exactly one DOM instance.
- Dock icon: 21 px; label: 10/13 px; vertical layout with 2 px gap.
- Page title: 34/41 px, weight 700.
- Navigation/section/row title: 17 px with 600/600/500 weight by hierarchy.
- Secondary copy: 15/21 px, regular weight.

## Combined visual inspection

Reference and implementation were placed in one comparison input and one 50% overlay:

- `apple-swipe-reference-comparison.png`
- `apple-swipe-reference-overlay.png`
- `apple-reference-shopping-swipe-390x844.png`
- `apple-reference-core-pages-390x844.png`

The files are stored in the current Codex visualizations directory for this thread.

Visible corrections after the first comparison pass:

1. Removed the non-system `Elms Sans` font from the first position in the CSS stack.
2. Moved action labels outside the colored pill and aligned them to the pill center.
3. Matched the source's neutral / blue / destructive surface ordering.
4. Hid the ordinary row More control while the swipe rail is open so a fourth dots
   symbol cannot remain visible beside the three transient actions.
5. Forced the dock to icon-over-label layout and made icon, label and shared bubble use
   one fixed coordinate system.
6. Increased secondary gray contrast from the previous faint web gray to the system
   hierarchy used by the source references.

## Functional checks

- `npm run build`: passed.
- `npm run lint`: passed.
- `npm test -- --run`: 22 files, 116 tests passed.
- Five primary routes rendered at 390 × 844 with one persistent dock instance.
- Rapid navigation sequence ended at the latest clicked target with one shared bubble;
  dock geometry remained 334 × 66 at y=766.
- Existing swipe callbacks, route handlers, task actions, shopping actions and finance
  calculations were not modified.

## Remaining device-specific verification

- The code was rendered in local Chrome with iPhone-size CDP metrics, not on a physical
  iPhone. Safari font rasterization, Home Screen PWA blur compositing and Home Indicator
  spacing still require physical-device verification.
- The reference uses filled proprietary system glyphs in its swipe crop. The app keeps
  the requested single round-line icon family, so icon fill geometry is intentionally
  not a pixel-identical copy.
