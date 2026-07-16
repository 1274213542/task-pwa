# Design QA — compact information architecture rebuild

## Final result

final result: passed

## Evidence

Final captures:

- `qa/redesign-final/01-overview-mobile.png` — start dashboard, `390 × 844`.
- `qa/redesign-final/02-tasks-mobile.png` — compact task baseline.
- `qa/redesign-final/03-month-mobile.png` — month overview without day details.
- `qa/redesign-final/04-timeline-mobile.png` — refined weekly timeline.
- `qa/redesign-final/05-shopping-mobile.png` — compact shopping/location layout.
- `qa/redesign-final/06-browse-mobile.png` — categories and completion records.
- `qa/redesign-final/07-calendar-desktop.png` — desktop month application.
- `qa/redesign-final/08-overview-320.png` — narrow responsive check.

Reference comparison inputs:

- `qa/redesign-final/compare-tasks.png`
- `qa/redesign-final/compare-month.png`
- `qa/redesign-final/compare-timeline.png`
- `qa/redesign-final/compare-desktop.png`
- `qa/redesign-final/overlay-tasks.png`
- `qa/redesign-final/overlay-month.png`
- `qa/redesign-final/overlay-timeline.png`

## Visible checks

### Task baseline

- Passed: header, filter rail and bottom dock use the same horizontal geometry as
  the supplied mobile crop.
- Passed: task rows are `72px` minimum, four real tasks fit above the fold, and
  the artificial notch/progress panel is removed.
- Passed: the real settings action replaces the nonfunctional notification icon.
- Passed: navigation has four distinct routes plus one centered add action.

### Calendar

- Passed: month mode contains no `.calendar-day-panel`; scheduled dates are
  directly highlighted and the canvas has no horizontal overflow.
- Passed: timeline bars are thinner and rounder with a compact time rail.
- Passed: tapping add switches to agenda and opens the composer without focusing
  a text field; tapping edit opens a dialog with the dialog surface focused.
- Passed: existing task/event editors, save/delete controls and stored IDs remain
  unchanged.

### Overview, shopping and utility pages

- Passed: `/` redirects to `/overview`; today/week/shopping/fixed/calendar and
  upcoming summaries are live database projections.
- Passed: shopping location remains a small secondary control; item add/check is
  still the dominant flow.
- Passed: categories/completion records remain accessible without occupying a
  primary navigation slot.

### Desktop

- Passed: `288px` persistent sidebar includes nav, mini month and category/filter
  information; the calendar uses the remaining full canvas.
- Passed: desktop task composer remains reachable after mobile-only headers are
  hidden.
- Passed: desktop month cells show real item titles and counts.

### Theme, recurrence and accessibility

- Passed: switching `violet-lime → aqua-garden → violet-lime` changed persisted
  `data-ui-theme`, background and accent values in the rendered app.
- Passed: custom recurrence rendered `every X` controls; choosing `3 months`
  changed the stored interval input to `3`.
- Passed: recurrence engine tests cover three- and six-month anchor behavior.
- Passed: `320px` viewport had `scrollWidth === innerWidth`; dock stayed inside
  the viewport and safe-area rules remained active.
- Passed: reduced-motion CSS disables nonessential movement.

## Automated verification

- `npm run lint`: passed.
- `npm test -- --run`: 56 tests passed.
- `npm run build`: passed; PWA generated 13 precache entries.
- Nonblocking build note: the main JS chunk remains above Vite's 500kB advisory.

## Intentional differences from the concept reference

- Task cards are deliberately thinner than the concept after the user's explicit
  correction that the previous cards were too heavy.
- Month mode omits the concept's selected-day card because the product direction
  now defines month as overview only; details live in agenda.
- Real Chinese product labels and actual stored tasks replace fake review/team
  metadata.
- Device status bars, home indicators and the unlicensed portrait are not drawn
  inside the web viewport.
- Desktop evidence uses the real month dataset; empty early-month cells reflect
  stored data rather than decorative mock events.
