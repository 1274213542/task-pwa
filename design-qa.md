# Design QA — mobile system convergence

- source visual truth path: `/tmp/codex-remote-attachments/019f6aaf-6257-7fe3-8983-40abdf7de072/D631D0C3-EB3D-4E28-B314-567DA4C9029A/`
- implementation screenshot path: `/Users/zhangzirui/Documents/New project 2/task-pwa/qa/mobile-unification/`
- implementation URL: `http://127.0.0.1:4185/task-pwa/`
- viewport: Browser Harness, 390 × 844 CSS px, touch emulation; desktop checks at 1440 × 1000
- state: neutral light theme; weekly task composer expanded; plan month and agenda states; grouped shopping; finance overview; browse categories and completion records
- source caveat: the supplied iPhone captures are the defect baseline. Their visible structure is compared directly, while the user's written neutral-system requirements are authoritative where the screenshots intentionally show styles to remove (for example the cyan composer outline).

## Full-view comparison evidence

- Tasks: `qa/mobile-unification/compare-tasks.png`
- Month plan: `qa/mobile-unification/compare-plan-month.png`
- Finance: `qa/mobile-unification/compare-finance.png`
- Additional rendered screens: `00-overview-mobile.png`, `03-plan-agenda-mobile.png`, `04-shopping-mobile.png`, `06-browse-mobile.png`, `07-plan-desktop.png`, and `08-finance-desktop.png`

## Focused region comparison evidence

- Task filters, composer, and compact task rows: `qa/mobile-unification/compare-tasks-focus.png`
- Month controls, date states, and selected-day summary: `qa/mobile-unification/compare-plan-month-focus.png`
- Finance tabs, currency selector, and top summary cards: `qa/mobile-unification/compare-finance-focus.png`

## Findings

- No actionable P0, P1, or P2 visual differences remain in the browser-rendered states.
- Fonts and typography: the implementation uses one system sans-serif stack and a stable page/section/card/body/meta hierarchy. Chinese labels no longer compete with decorative symbols; small supporting text remains readable at 390 px.
- Spacing and layout rhythm: primary pages share a 16 px mobile gutter, 20 px section rhythm, 10 px row rhythm, 44 px action controls, and common card padding. Month plan structure and source proportions are closely aligned. Task and shopping rows are intentionally denser than the baseline to meet the stated information-efficiency goal.
- Colors and tokens: large green, purple, pink, and cyan areas were removed. Surfaces are white on `#F3F4F2`, with `#111111` text, neutral selected fills, one-pixel borders, and limited state color.
- Image quality and assets: these screens require no photographic assets. Visible icons come from the existing unified `AppIcon` icon system; no emoji, placeholder image, or new CSS illustration replaces a target asset.
- Copy and content: mobile shortcut copy is absent; `未来 30 天` exposes count and nearest date; shopping empty groups use a compact `暂无商品 / 添加` action; blank plan rows are filtered instead of rendering empty cards.
- States and accessibility: task composer does not autofocus, maintains a visible neutral focus boundary, and leaves task rows in view. Shared navigation has one persistent indicator, route content has one mounted transition surface, reduced-motion removes route travel, and touch targets remain at least 44 px where actionable.

## Comparison history

### Iteration 1 — blocked

- [P2] The task composer had a cyan outline and excessive visual weight. Fixed by applying the shared neutral card border, reducing composer height, and grouping task type controls as one segmented control.
- [P2] Plan rows could look blank after the neutral-theme change because legacy tone selectors left white text on a white surface. Fixed by filtering invalid empty titles and mapping plan-row text back to neutral foreground tokens.
- [P2] Shopping exposed persistent drag/delete controls and large empty drop zones. Fixed by moving ordering and deletion into one temporary menu and reducing empty locations to one compact action row.
- [P2] Finance management and empty-stat modules dominated the initial viewport. Fixed by restoring work/pay/spending summaries to the top, keeping account/net-worth context compact, combining empty statistics, and moving detail management into secondary views.

### Iteration 2 — passed

- Post-fix evidence: `compare-tasks.png`, `compare-plan-month.png`, `compare-finance.png` and their focused variants.
- Browser-rendered checks found zero document-level horizontal overflow at 390 px; 320 px retains zero document overflow and uses intentional horizontal scrolling only inside dense segmented controls.
- Primary interactions tested: rapid tab switching, interruptible shared indicator, directional route transition, task composer open/close without autofocus, exclusive shopping menu, outside-click close, selected date updates, and reduced-motion route switching.
- Runtime errors checked: `window.error` and `unhandledrejection` collection remained empty while navigating all five primary routes and exercising task/shopping interactions.
- Production build service worker was verified with the latest hashed CSS/JS and an offline reload in a controlled Chromium preview.

## Residual test gaps / P3 follow-up

- No physical iPhone is connected to this environment and Xcode device tooling is unavailable. Safari page mode, standalone PWA safe-area values, keyboard resize, native font rasterization, low-power mode, and background restoration still require real-device confirmation. This is a device-validation gap, not a browser-rendered design mismatch.
- Source and implementation contain different live data values, so financial number widths and task completion counts were judged by hierarchy and resilience rather than pixel-identical content.

final result: passed
