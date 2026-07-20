# Design QA — system UI structure pass 2

- viewport: 390 × 844 CSS pixels, DPR 3
- browser: local Chrome CDP mobile viewport
- reference: `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/785738DB-F8B7-4D22-9E8D-7FB0848B3498/2-照片-2.jpg`
- implementation: `/tmp/task-pwa-system-ui-pass2-task.png`
- combined comparison: `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/task-ui-reference-comparison.png`

## Visible checks

- [x] Task header, toolbar controls, title weight, and mobile page margins match the established reference proportions.
- [x] Task rows share an identical 44px check column, title origin, metadata origin, row height, and divider inset.
- [x] The grouped card owns the outside boundary; static rows do not add individual rounded cards or duplicate borders.
- [x] A real swipe gesture exposes two equal 56px actions; More and Delete remain fixed, centered, complete, and non-overlapping.
- [x] The moving foreground owns the divider, so the line translates and fades with the row.
- [x] The task editor has a stable header and an independently scrollable body; the last destructive action remains reachable.
- [x] Schedule choices use one compact three-part pill and all date/time inputs remain inside the sheet padding.
- [x] Shopping location management uses one shell, flat rows, one composer boundary, and no latent rounded empty-state edge.
- [x] Finance transactions use one title divider, one row divider, one external-payment label, and a stable right-aligned amount column.
- [x] Account and fund rows defer secondary controls to one disclosure instead of a permanent button wall.
- [x] Bottom safe-area compensation leaves the final content above the floating navigation.
- [x] No new console errors were observed in the exercised task, editor, shopping, and finance routes.

## Interaction checks

- [x] Task list row alignment measured equal across both test rows.
- [x] Task editor scroll range measured from 0 to 553.8px; Delete Task is visible at the lower limit.
- [x] Background scrolling is locked while the editor sheet is open.
- [x] Swipe actions measured 55.99px × 55.99px each with a stable 4px rail gap.
- [x] Navigation, finance tabs, shopping mode selector, and edit actions remain functional.

final result: passed
