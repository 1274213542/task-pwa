# Design QA — fund removal, shopping locations, plan editing, date markers

## Test frame

- Viewport: 390 × 845 CSS px
- Browser: local Chromium through the project browser harness
- Source comparisons: the user's 588 × 1280 iPhone captures were normalized to the same 390 × 845 frame before comparison.
- Combined comparisons:
  - `/tmp/task-pwa-shopping-comparison.png`
  - `/tmp/task-pwa-editor-comparison.png`

## Shopping location manager

- Before: a gray band sat behind each location, the outer card and inner blocks repeated the same boundary, and the composer was visually mixed into the list.
- After: one 24px-radius shell owns the boundary; each 58px location row is transparent; only adjacent rows draw one inset divider; the composer is a separate final section with one top divider.
- Checked with three realistic locations: 杉药局、肉のハナマサ、Amazon.
- Empty shopping state remains a separate compact card and the floating tab bar does not cover it.

## Plan event editor

- Before: the header appeared as a separate white rectangle and the body relied on the sheet's outer overflow, so long forms could lock or be clipped.
- After: header and body share one sheet surface; `.event-editor-scroll` is the only vertical scroll owner; 633px viewport / 884px content produced a verified 251px scroll range and reached the final style controls.
- Start time display and persistence are timezone-aware. An event changed from 12:00 to 13:00, saved, closed, and immediately rendered as 13:00 in the calendar summary.

## Calendar date types

- Month view exposes one compact “批量标记” action.
- Batch sheet supports multi-date selection, 上班 / 上学 / 其他, custom types, apply and clear.
- Calendar cells show up to three small colored dots; date selection remains the dominant state.
- Verified two selected dates updating immediately without a page reload.

## Finance removal and compatibility

- Current finance navigation contains 总览、账户、流水、工资与工时、统计 only.
- No visible or interactive 资金池、新建资金池、重新分配、储蓄目标 or fund-allocation picker remains.
- Fund feature modules and active types were removed.
- Previously shipped v11 IndexedDB stores remain opaque compatibility stores and stay in backup/export coverage so an upgrade does not destructively drop historical user data.

## Regression checks

- TypeScript production build: passed.
- Lint: passed.
- Automated tests: 22 files / 119 tests passed.
- PWA service worker: registered and controlling the production preview.
- Offline reload: app shell and overview content loaded while network requests were disabled.
- Completed-last ordering: stable partition verified; pending relative order and completed relative order are preserved.
- Date markers: deterministic IDs, idempotent reapply, tombstone clear, and same-key restore verified.

final result: passed
