# Design QA — Neutral foundation

## Comparison inputs

- Task source: `/Users/zhangzirui/Downloads/IMG_3166.PNG`
- Task render: `/tmp/task-neutral-final-task-402x874.png`
- Calendar source: `/Users/zhangzirui/Downloads/IMG_3167.PNG`
- Calendar render: `/tmp/task-neutral-final-plan-402x874.png`
- Finance source: `/Users/zhangzirui/Downloads/IMG_3169.PNG`
- Finance render: `/tmp/task-neutral-final-finance-402x874.png`
- Combined comparisons: `/tmp/task-neutral-compare-task.png`, `/tmp/task-neutral-compare-plan.png`, `/tmp/task-neutral-compare-finance.png`

All mobile source and render pairs use the same 402 × 874 CSS viewport (1206 × 2622 at 3× capture density).

## Result

### P0

- None. Mobile navigation has one safe-area clearance path, content scrolls above it, and the 360 px and 402 px layouts have no horizontal overflow.
- Keyboard-height simulation keeps the composer textarea and add control visible and removes the dock from the usable viewport.

### P1

- None. Large decorative leading marks, colored card fills, duplicate finance summaries, desktop shortcut text on mobile, and ambiguous add/close semantics were removed.
- Page headings, segmented controls, cards, calendar states, shopping groups, finance statistics, and navigation now use the shared neutral surface system.

### P2

- None. The final comparison pass confirmed consistent gutters, radii, borders, readable hierarchy, and a single neutral focus action per page.

### P3 follow-up notes

- Validate iOS safe-area insets and the software keyboard once more on a physical iPhone Safari and installed PWA; Chromium device emulation cannot prove WebKit-only behavior.
- The existing JavaScript bundle remains above Vite's 500 kB advisory threshold. This is a performance follow-up and does not block the visual foundation.

## Verification

- Production build passed.
- 64 automated tests passed across 9 test files.
- PWA service worker activated and precached the current CSS/JS assets; the cached app shell reloaded successfully.
- Shared bottom-navigation indicator remained a single element through rapid multi-tab switching and settled on the latest target.
- Desktop calendar verified at 1440 × 1000 with a 288 px sidebar and a 1096 px main calendar surface.

## Final result

passed
