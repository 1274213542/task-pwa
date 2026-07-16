# Task PWA — measured reference specification

This document is an implementation contract derived from the supplied task,
month-calendar, time-rail and desktop-calendar screenshots. It is not a mood
board. Functional data flows remain independent from these visual projections.

## Reference mapping

- Mobile task list: reference image 3 (primary baseline).
- Mobile month calendar: reference image 1.
- Mobile selected-day time rail: reference image 2.
- Desktop weekly calendar: wide reference image 7.
- Desktop month grid: wide reference image 8.
- Conflicts resolve in that order; existing data and accessibility behavior are
  preserved even when a screenshot does not depict them.

## Measured mobile canvas

- Validation viewport: `390 × 844` CSS px.
- Source phone frame: approximately `482 × 1042` inside the 1026 × 1280 image.
- Page/card gutter: `12px` (`10px` below 360px).
- Top round controls: `52px`; gap `12px`; profile/action radius `50%`.
- Filter rail: `54px`; pills `52px`; radius `21px`; gap `8px`.
- Task card: `134px` standard, `142px` charcoal feature; radius `30px`;
  vertical gap `9px`; top action `58px`.
- Task title: `22/28px`, weight 520–620 depending script rendering.
- Card meta: `11px`; status capsule `42px` high, radius `18px`.
- Bottom dock: `68px`, `12px` side gutter, `20px + safe-area` bottom inset,
  radius `29px`; central action `56px`.
- Month date circle: `36px`; 7 columns; 49px minimum row including one
  visible task-title summary.
- Week event: 66px minimum height, radius `24px`, 57px time-label rail.

## Measured desktop canvas

- Validation viewports: `1440 × 1000` and `1728 × 1117`.
- Persistent navigation rail: `280px`.
- Main calendar uses the remaining width; selected-day details flow below the
  calendar so the reference-sized seven-column board is not compressed.
- Week time rail: `70px`; day header `72px`; hour interval `80px`; event radius
  `21px`.
- Month cells: `116px` minimum at 1180px and above, increasing at wider widths.

## Color tokens

Core measured roles:

- `--ref-charcoal: #282828`
- `--ref-lime: #c8d67f`
- `--ref-purple: #a7a0d3`
- `--ref-neutral: #ededed`
- `--ref-lavender-wash: #f0eefb`
- App background remains the pre-redesign `#f7f7f8` to preserve the requested
  product background while matching the reference surfaces and controls.

Saved semantic colors remain `gray / blue / green / orange / pink / purple`.
An explicit saved task/category color overrides the reference-sequence surface;
records without a saved visual token use charcoal → lime → purple in list order.

## Typography and icons

- One system grotesk/CJK stack; no mixed display font.
- Primary mobile headings: 21–22px; desktop page heading: 42px.
- Body/input text: 16px minimum on mobile to avoid iOS focus zoom.
- Phosphor Icons is the only operational icon source, regular/rounded line
  weight; no emoji, inline SVG or text-symbol controls.
- Decorative category markers use Phosphor fill icons through the same color
  tokens.

## Component rules

- Task list default state matches the supplied card composition: title top-left,
  circular action top-right, time/type bottom-left, status capsule bottom-right.
- Add composers are collapsed until the real add button is pressed. They keep
  multiline batch input and do not alter stored data to produce the layout.
- Calendar month cells retain a readable first task title because the product
  requirement explicitly requires visible task summaries rather than dots.
- Calendar task taps open the existing editor without auto-focusing a field.
- Shopping location remains secondary and collapsed; item add/check efficiency
  stays primary.
- Touch targets are at least 44px; bottom/sheet surfaces include safe areas.

## Motion

- Press: 160–180ms, scale `.90–.96` depending control size.
- Menu: 180ms, opacity + small scale/translation.
- Composer/sheet: 260ms with `cubic-bezier(.16,.86,.26,1)`.
- Page: 260–460ms transform/opacity; forward/back directions stay opposite.
- Only `transform` and `opacity` animate during navigation and list feedback.
- `prefers-reduced-motion` disables nonessential movement.

## Visual QA contract

- Capture with the in-app browser at the fixed reference viewport.
- Put reference and implementation in a single side-by-side image, then inspect
  spacing, proportion, card silhouette, type hierarchy and color area.
- Repeat after P0/P1 fixes. Store evidence under `qa/screenshots/` and record the
  final verdict in `design-qa.md`.
