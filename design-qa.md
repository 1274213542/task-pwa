# Design QA — Apple-controlled mobile refresh

**Source visual truth paths**

- `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/80E77342-ADC4-44EF-8848-F96C82D9A2B6/1-照片-1.jpg`
- `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/80E77342-ADC4-44EF-8848-F96C82D9A2B6/2-照片-2.jpg`
- `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/80E77342-ADC4-44EF-8848-F96C82D9A2B6/3-照片-3.jpg`
- `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/80E77342-ADC4-44EF-8848-F96C82D9A2B6/4-照片-4.jpg`
- `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/80E77342-ADC4-44EF-8848-F96C82D9A2B6/5-照片-5.jpg`
- `/tmp/codex-remote-attachments/019f7905-c801-7d31-8fff-0cc15df5dd75/80E77342-ADC4-44EF-8848-F96C82D9A2B6/6-照片-6.jpg`

**Implementation evidence**

- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-plan-month-pass2-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-shopping-pass3-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-shopping-swipe-open-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-finance-overview-pass4-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-finance-accounts-pass4-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-settings-pass4-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-selection-picker-pass2-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-task-swipe-open-390x844.png`
- `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-category-swipe-open-390x844.png`

**Comparison evidence**

- Combined source/implementation contact sheet: `/Users/zhangzirui/.codex/visualizations/2026/07/19/019f7905-c801-7d31-8fff-0cc15df5dd75/apple-final-reference-comparison.png`
- Viewport: `390 × 844 CSS px`, DPR 3 for the final category interaction capture.
- State: neutral light theme; grouped management list, finance overview, and an opened three-action swipe rail.
- Full-view comparison: the contact sheet compares grouped settings, finance hierarchy, and swipe affordances in one input.
- Focused-region comparison was not split into another artifact because each comparison row already crops to one readable mobile screen and the relevant controls remain legible at original resolution.

**Findings**

- [P2] True iPhone Safari and standalone-PWA rendering remains unverified.
  Location: all mobile routes; safe-area, native momentum scrolling, Pointer Events and Web Animations handoff.
  Evidence: implementation captures were rendered in Google Chrome at an exact 390 × 844 emulated viewport; no connected iPhone Safari Web Inspector session was available.
  Impact: iOS-specific safe-area, font rasterization, backdrop-filter and pointer-capture behavior cannot be certified from Chrome evidence.
  Fix: run the supplied regression states in iPhone Safari and the installed PWA, with Reduce Motion both off and on, then attach those captures here.

- [P3] Management rows remain slightly denser and more neutral than the colorful source Settings examples.
  Location: `Browse`, `Settings`, `SelectionPickerSheet`.
  Evidence: the source uses branded per-row icon tiles while the implementation deliberately retains the app's existing monochrome Phosphor icon language.
  Impact: the composition matches the grouped-list hierarchy but does not copy Apple's color or proprietary icon treatment, as required by scope.
  Fix: acceptable intentional deviation; no change required.

- [P3] The finance overview contains more summary modules than the Wallet balance reference.
  Location: `FinanceLedger` overview.
  Evidence: the source prioritizes one stored-value balance and recent transactions; the implementation must retain net worth, dedicated funds, work and spending summaries.
  Impact: product information density is higher, but the amount typography, grouped-list rhythm and action hierarchy now follow the reference patterns.
  Fix: acceptable business-content constraint; continue using grouped rows rather than enlarging cards.

**Required fidelity surfaces**

- Fonts and typography: system font stack is retained; mobile page title, secondary title, row title, status, description and amount levels are tokenized. Chinese, Japanese and numeric fallback remain system-native; financial numbers use tabular numerals.
- Spacing and layout rhythm: 4 px scale, 16 px mobile gutters, 12 px grouped-card gaps, 24/32 px section rhythm, 48 px segmented controls, 56/68 px grouped rows and nav-safe bottom padding are applied.
- Colors and tokens: existing neutral product palette is retained. Surface, divider, text, selected control and danger colors use shared tokens; no Apple proprietary palette was copied.
- Image quality and asset fidelity: the app has no source-dependent hero or decorative imagery in the modified surfaces. Existing icon-library vectors are preserved; no emoji, CSS drawings or handcrafted replacement SVGs were introduced.
- Copy and content: existing task, shopping, finance and settings copy remains product-specific. Only the Settings title was localized to match the rest of the Chinese UI.
- Icons: existing Phosphor-derived `AppIcon` family is retained at unified 18/20/22 px optical sizes.
- Accessibility: interactive controls keep at least 44 px hit areas, semantic buttons and labels; shared swipe actions have menu-equivalent existing controls, and reduced motion disables settling travel.

**Comparison history**

1. Pass 1 — token and structural drift.
   - Earlier findings: inconsistent mobile title scales, radius values, segmented-control geometry, isolated list cards, full-width dividers and mismatched icon-button sizes.
   - Fixes: established shared typography/spacing/radius/row tokens; added `GroupedList`, `MobilePageHeader` and persistent `SegmentedIndicator`; normalized plan, shopping, finance and management pages.
   - Post-fix evidence: plan, shopping, finance, settings and picker screenshots listed above.
2. Pass 2 — interaction-state mismatch.
   - Earlier findings: task/shopping swipe states did not share the same three-action geometry, and management/finance lists had no reference-like row action rail.
   - Fixes: added a one-open-row swipe contract, direction lock, thresholded settle, outside/scroll/route cleanup and 68 × 44 px rounded actions. Added the same visual wrapper to finance rows and category management without changing callbacks.
   - Post-fix evidence: task, shopping and category swipe screenshots listed above.
3. Pass 3 — runtime regression from the shared wrapper.
   - Earlier finding: importing the motion package through the generic list wrapper produced a circular production chunk and a blank screen.
   - Fix: removed that dependency from the wrapper and implemented direct Pointer Events plus interruptible Web Animations using only `transform` and `opacity`.
   - Post-fix evidence: 390 × 844 management page loaded with zero captured runtime errors; category swipe settled at `translateX(-212px)` with three `68 × 44px` actions.

**Primary interactions tested**

- Shared segmented selection geometry and route-stable controls.
- Shopping and task swipe open/close states.
- Category swipe threshold, one open row, action dimensions and transform settle.
- Page load after production build, including the previously failing management route.
- Console/runtime error capture: no application errors in the final Chrome checks.

**Implementation Checklist**

- [x] Shared typography, spacing, radius, icon-button and grouped-row tokens.
- [x] Plan, shopping, finance, settings and management grouped-list surfaces.
- [x] Persistent shared segmented indicators.
- [x] Task, shopping, transaction and category swipe wrappers preserving existing callbacks.
- [x] Lint, 116 automated tests and production build.
- [ ] True iPhone Safari and installed-PWA visual/gesture regression.
- [ ] Reduce Motion on/off validation on the real device.

**Follow-up Polish**

- Revisit only if true-device testing exposes font wrapping, safe-area or backdrop-filter differences.
- Consider recording the shared segmented indicator and swipe interruption after deployment; no further decoration is recommended.

**final result: blocked**

Blocker: true iPhone Safari and standalone-PWA evidence required by the user is not available in this environment.
