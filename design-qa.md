# Design QA — overview, daily history, quick entry and calendar markers

## Test frame

- Viewport: 390 × 845 CSS px.
- Browser: local Chromium controlled through Browser Harness.
- Production shell: Vite preview with the generated Service Worker controlling the page.
- User reference: the supplied 588 × 1280 iPhone month-calendar screenshot, normalized to the same frame.
- Comparison artifacts:
  - `qa/overview-daily-calendar/plan-month-comparison.png`
  - `qa/overview-daily-calendar/plan-month-overlay.png`

## Overview

- A date-scoped daily completion remains in “今天需要处理”, uses a checked/struck-through state and sorts after pending items.
- Restoring the completion returns the same task to pending; its deterministic record ID is reused.
- Future-seven marker geometry and colors use the same shared marker model as the month calendar.
- “下一步” rejects the synthetic date of an ordinary today task and only admits an authored DDL/end date within seven days.
- Screenshot: `qa/overview-daily-calendar/overview-mobile.png`.

## Daily history

- The daily task page exposes a compact rolling seven-day history.
- Completion date/time, restored state and restore action remain aligned at 390 px.
- Date-scoped IDs prevent a second active history row after complete → restore → complete.
- Screenshot: `qa/overview-daily-calendar/daily-history-mobile.png`.

## Quick entry

- The 390 px viewport produced a 364 px Sheet with equal client/scroll widths; document and body both remained 390 px wide.
- Amount, date, picker and textarea fields share 16 px inline padding and do not change width when populated.
- The transaction-kind strip is the only intentional horizontal scroller.
- Default transaction date uses the local civil date rather than UTC.
- Screenshot: `qa/overview-daily-calendar/finance-quick-entry-mobile.png`.

## Plan and calendar

- Duration formatting renders `10小时44分` rather than a floating-point hour value, and zero renders `0 小时`.
- Marker layout uses a centered fixed track: up to three explicit dots, followed by `+N` overflow. This remains bounded for one through five categories and does not alter the date hit target.
- Selected-date summary reads the same date-type marker rows as the month cell and includes them in its count.
- Screenshot: `qa/overview-daily-calendar/plan-month-mobile.png`.

## Regression checks

- Automated tests: 24 files / 124 tests passed.
- Lint: passed.
- TypeScript production build: passed.
- PWA precache: 46 entries generated; Service Worker registered and controlled the production preview.
- Offline reload: the production overview loaded while network requests were disabled.
- Reduced-motion emulation: enabled successfully without horizontal overflow.
- Five primary routes switched without captured runtime or console errors.
- Real iPhone Safari and installed Home Screen PWA remain a user-device verification step; no desktop capture is labeled as a real-device result.

final result: passed
