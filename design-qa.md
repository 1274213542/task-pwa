# Unified swipe, schedule and calendar QA

Date: 2026-07-20

Reference: supplied Apple Voice Memos swipe-action frame

Implementation viewport: 390 × 844 CSS px at DPR 3

## Scope

- One reusable two-layer `SwipeActionRow` now drives shopping goods, task and
  subtask rows, plan items, category/record rows, work entries and finance ledger
  rows. Business callbacks remain owned by their original feature modules.
- The visible foreground is the only translated layer. The fixed rear layer contains
  exactly two actions: More and Delete. Shopping relocation remains long-press drag,
  with the existing “移动到…” menu fallback.
- Plan Time now distinguishes scheduled ranges, all-day entries and entries without
  a specific time. A 300 ms hold hands control to the schedule drag only after the
  gesture has not already become a swipe or vertical scroll.
- Calendar selection, DDL sorting, segmented-control geometry, radii and secondary
  text use shared design-system rules.

## Final design tokens and geometry

- Font stack: `-apple-system`, BlinkMacSystemFont, SF Pro Text/Display,
  PingFang SC, Hiragino Sans, Yu Gothic, Segoe UI, sans-serif.
- Primary text: stable near-black; secondary text: readable medium gray at weight
  500 for small metadata; tertiary and disabled states remain visibly distinct.
- Radius vocabulary: pill `999px`, controls `18px`, cards `24px`, panels `28px`,
  sheets `32px`, circles `50%`.
- Shared segmented control: 48 px track, 40 px active pill, exact 4 px inset and one
  persistent indicator moved with transform.
- Swipe rail: two 56 px columns with one 4 px gap, total reveal 116 px.
- Action visual: 56 × 56 px group, 56 × 36 px pill, 18 px rounded-line icon,
  11/16 label. Both actions share the row's vertical center.
- Divider opacity and visible length are derived from the same live drag progress;
  there is no stationary decorative divider behind the moving row.
- Mobile dock and every scrolling page retain bottom navigation plus safe-area
  clearance.

## Gesture arbitration

- Pointer movement locks only after direction intent is clear. Horizontal movement
  owns swipe; vertical movement releases to native page scrolling.
- Swipe release combines distance and velocity, then settles to 0 or −116 px from
  the current presentation position. A new gesture cancels the previous Web Animation
  and continues from the visible position.
- Opening a row dispatches one shared close event, so another open row closes
  immediately. Outside interaction, scroll, route change and `visibilitychange`
  also clear the state.
- Plan Time reserves its drag only after a 300 ms hold. During active schedule drag,
  pointer movement is captured above the nested swipe row; before activation, normal
  scrolling and horizontal swipe remain available.
- Scheduled drag maps 12 vertical CSS px to 15 minutes and 76 horizontal CSS px to
  one date. Events preserve end time; tasks keep their existing ID and record rather
  than creating duplicates.

## Calendar and task ordering

- Normal date: transparent surface and dark text.
- Date with items: light-gray surface and dark text.
- Selected date: one persistent black shared pill with white text; selection wins
  over item presence.
- Smart task priority is deterministic: overdue, today due, near due, today schedule,
  daily without DDL, executable long-term, other due, long-term without DDL, other,
  then completed. Manual ordering remains stable when the user selects manual sort.
- Daily tasks without DDL are not deleted, duplicated or marked overdue at midnight.
  DDL labels are derived from real dates and stop counting after completion.

## Visual comparison

The reference and implementation were normalized to the same 390 × 844 canvas and
inspected side-by-side and at 50% opacity:

- `qa/unified-swipe-schedule/reference-current-side-by-side.jpg`
- `qa/unified-swipe-schedule/reference-current-overlay.jpg`
- `qa/unified-swipe-schedule/shopping-swipe-390x844.png`
- `qa/unified-swipe-schedule/task-swipe-390x844.png`
- `qa/unified-swipe-schedule/plan-time-swipe-390x844.png`
- `qa/unified-swipe-schedule/calendar-states-390x844.png`
- `qa/unified-swipe-schedule/task-composer-pills-390x844.png`

The comparison confirms that the compact two-action group remains centered in its
own row, its red pill is not clipped, labels sit below their icons, foreground
dividers disappear with the translated row, and the segmented controls use complete
outer and inner pill geometry. The product intentionally retains its rounded line
icon family rather than copying Apple proprietary glyphs.

## Automated and browser regression

- `npm run lint`: passed.
- `npm test -- --run`: 23 files, 120 tests passed.
- `npm run build`: passed; PWA generated with 46 precache entries.
- Shopping swipe: slow swipe, fast swipe, reversal and two-row mutual exclusion passed.
- Task swipe: interactive title no longer steals the horizontal gesture; More/Delete
  open to the same 116 px rail.
- Plan Time: ordinary scroll, horizontal swipe and 300 ms schedule drag remain
  mutually exclusive; vertical and cross-date drops persisted without duplicate IDs.
- Calendar: the same selected indicator moved between dates; item marker updated from
  task/event state.
- Reduced Motion: core state changes remained visible with no queued page animation.
- No browser console error was observed during the mobile regression route.

## Environment boundary and remaining physical-device checks

- Automated interaction used Browser Harness with Chromium at 390 × 844, not a
  physical iPhone. It validates DOM geometry, interruption, persistence, PWA cache and
  offline behavior but cannot certify WebKit glyph rasterization or Home Screen
  compositing.
- A real iPhone still needs a short Safari and standalone-PWA pass for touch velocity,
  safe-area behavior, background restore and Reduce Motion on/off.

final result: passed
