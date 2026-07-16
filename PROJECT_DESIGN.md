# Task PWA — compact reference-calibrated design contract

This contract is measured from the supplied `REFERENCE / IMPLEMENTATION`
comparisons at `390 × 844` and the wide desktop calendar. It deliberately
separates stored product data from its visual projection.

## Information architecture

- App start: `总览` (`/overview`). It summarizes today, this week, shopping,
  recurring tasks, the next seven days and the next four actionable items.
- Primary navigation: `总览 / 任务 / 计划 / 购物`; the centered add control is
  an action, not a duplicate route.
- `分类与记录` remains reachable from overview and the desktop sidebar. It is a
  utility screen, not an unexplained primary tab.
- Calendar modes keep their existing functionality: month = overview, time =
  selected-week timeline, agenda = details, add and edit.

## Measured mobile system

- QA viewport: `390 × 844`; narrow check: `320 × 568`.
- Page gutter: `16px`, reduced to `12px` below 360px.
- Header controls: `44 × 44px`; header band `72px`.
- Filter band: `46px`; pills `42px` high, `17px` radius, `6px` gap.
- Compact task row: `72px` minimum, `20px` radius, `7px` list gap. No masked
  notches, decorative team panel, or oversized arrow control.
- Bottom dock: `64px`, `14px` side inset, `12px + safe-area` bottom inset,
  `24px` radius; central action `50px`.
- Month dates: `34px` circles. Scheduled dates use the item color directly;
  month mode does not append a selected-day detail list.
- Timeline event: `52px` minimum, `22px` radius, `48px` time rail, `68px` row.
- Touch targets stay at least `44px`; text inputs remain `16px` on mobile.

## Desktop system

- QA viewport: `1440 × 1000`.
- Persistent sidebar: `288px` with identity, primary navigation, mini calendar,
  categories or meaningful fixed/normal fallback filters, settings and search.
- Main month grid owns the remaining canvas. Cells are `104px` minimum and grow
  to `118–132px` at wider breakpoints.
- Calendar uses real titles in desktop cells; mobile month mode uses colored
  dates only to preserve the requested overview density.
- Overview becomes a two-column dashboard rather than a stretched phone page.

## Visual tokens

- Background: `#f7f6f2`; surface: `#ffffff`; soft surface: `#efeee9`.
- Ink: `#1d1e1b`; muted: `#73756e`; line: `#e2e1db`.
- Main accent: `#dbe77d`; secondary: `#dcd9ef`; dark: `#20211f`.
- Panel/card/control radii: `26 / 20 / 16px`.
- Shadows are reserved for floating menus and drag state; normal cards are flat.
- Persisted alternative themes update background, surfaces, ink, accents and
  calendar/task surfaces together; they are not one-variable color swaps.

## Typography and icons

- System grotesk/CJK stack: SF Pro Text, PingFang SC, Hiragino Sans, Yu Gothic
  UI, Segoe UI.
- Mobile page title `19px`; task title `15px`; metadata `10–11px`; desktop page
  title `43px`.
- Operational icons use the existing Phosphor family only. Category markers use
  the same semantic color tokens.
- The original notification concept is not reproduced because the product has no
  notification feature; the corresponding real action is settings.

## Recurrence and data compatibility

- The existing `fixed_schedule` rule already stores `frequency + interval`.
- The UI now exposes `every X days / weeks / months`, with one-, three- and
  six-month shortcuts. No schema rewrite or destructive migration is required.
- Recurrence templates and completion records remain separate; visual changes do
  not create occurrences or mutate completion history.

## Motion

- Press feedback: `160–180ms`, transform only.
- Navigation/content transitions: `180–260ms`, opacity and small translation.
- Menus/sheets: `180–260ms`; task drag remains interruptible.
- `prefers-reduced-motion` collapses nonessential animation to near-zero.

## Visual QA contract

- Capture fixed-size implementation screenshots in the in-app browser.
- Crop the supplied reference to the same `390 × 844` canvas.
- Produce both side-by-side and 50% alpha overlays for task, month and timeline.
- Preserve intentional product differences in the QA notes rather than hiding
  them with decorative similarity.
