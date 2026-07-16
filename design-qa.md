# Design QA — reference fidelity rebuild

## Final result

final result: passed

## Sources and states compared

- Mobile task reference: supplied image 3, measured phone crop, compared against
  `qa/screenshots/mobile-today-final.png` at `390 × 844`.
- Mobile month reference: supplied image 1, measured phone crop, compared against
  `qa/screenshots/mobile-plan-month-final.png` at `390 × 844`.
- Mobile timeline reference: supplied image 2, measured phone crop, compared
  against `qa/screenshots/mobile-plan-week-final.png` at `390 × 844`.
- Desktop weekly reference: supplied wide calendar reference, compared against
  `qa/screenshots/desktop-plan-week-final.png` at `1440 × 1000`.
- Desktop month reference: supplied wide month reference, compared against
  `qa/screenshots/desktop-plan-month-final.png` at `1440 × 1000`.
- Narrow mobile check: `qa/screenshots/mobile-320-today.png` at `320 × 568`.
- Compact desktop check: `qa/screenshots/desktop-1024-plan.png` at `1024 × 768`.

Combined comparison inputs:

- `qa/screenshots/mobile-today-comparison-final.png`
- `qa/screenshots/mobile-plan-month-comparison-final.png`
- `qa/screenshots/mobile-plan-week-comparison-final.png`
- `qa/screenshots/mobile-today-overlay-final.png`

## Visible checks

### Mobile task baseline

- Passed: top profile/action geometry, 52px circular controls, horizontal filter
  rail, black/lime/purple area ratio, 30px card silhouette and 58px task action.
- Passed: live progress card replaces decorative team data while preserving the
  reference panel height and rhythm.
- Passed: 68px dark dock, 56px central action, 20px bottom inset and safe-area
  backing surface.
- Passed: long Chinese title wraps to two lines without clipping at 320px.

### Mobile calendar and timeline

- Passed: circular month dates, readable first task title, selected/today states,
  visible selected-day card and direct add control.
- Passed: selected-day week strip, time rail, lime/purple/charcoal event sequence
  and rounded event blocks.
- Passed: opening a calendar task produced an active dialog, not an active input;
  the keyboard did not open automatically.
- Passed: title edit saved to the existing task, updated the calendar immediately
  and remained after reload.

### Desktop

- Passed: persistent 280px rail, full-width seven-column board, 70px time rail,
  80px time rows and large readable event cards.
- Passed: month view uses the available desktop canvas and shows real task titles
  in cells rather than dots or counts alone.

### Interaction and stability

- Passed: rapid task → plan → shopping → browse navigation ended on the correct
  route with one active state and no animation pile-up.
- Passed: batch shopping add created three ordered items from three non-empty
  lines and returned to the stable list state.
- Passed: task action menu opened through touch/click without toggling completion.
- Passed: page changes reset vertical/horizontal scroll; editors retain their own
  scroll state.
- Passed: build, lint and all 55 unit tests.

## Remaining intentional differences

- The source screenshot's iOS status bar and physical phone frame are device
  chrome and are not reproduced inside the PWA viewport.
- The source portrait is not licensed as an application asset; the existing app
  identity image occupies the same measured slot.
- Real product labels, task titles, recurrence state and progress replace fake
  review/team metadata from the concept artwork.
- The real month/week/agenda mode switch stays visible because all three shipped
  modes must remain discoverable.
- Mobile month cells keep one task-title summary to satisfy the product requirement
  that dates with tasks show actual content, not only colored circles.

## Runtime note

Local development logs contain expected Dexie Cloud `Failed to fetch` entries
because the local preview cannot reach the configured sync service in the
restricted test environment. No React render, routing or application exceptions
were observed. Online sync is verified separately after deployment.
