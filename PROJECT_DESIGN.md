# Task PWA — Reference-led product design system

## 1. Product context

- Product: offline-first personal tasks, calendar, shopping list and completion archive.
- Primary job: add, scan, complete and reschedule work quickly on a phone; plan across a larger calendar on desktop.
- Required content: daily/weekly tasks, recurring state, calendar items, categories, shopping items, sync and backup states.
- Required interaction: touch-first controls, long-press sorting, inline quick add, calendar editing without auto-focus, offline continuity.
- Technical constraints: React 19, Tailwind 4 plus global CSS, Dexie/Dexie Cloud, Vite PWA, no destructive data reset.

## 2. Existing UI read

- Preserve: `#f7f7f8` light app background, `#1c1c1e` dark background, bottom navigation behavior, safe-area handling, keyboard viewport handling, page routes and all data workflows.
- Reuse: PageHeader, TaskRow, editors, segmented controls, live Dexie queries, current category color tokens.
- Evolve: the flat list-card vocabulary, narrow desktop container, page-specific but disconnected colors, tiny utility icons.
- Remove: sharp/square operational surfaces, thin gray-on-gray hierarchy, desktop layout that only stretches the mobile page, one-off glyphs such as text crosses and arrows.

## 3. Taste direction

- Identity: a rounded, colorful personal planning tool with serious information hierarchy.
- Direction: soft lilac/lime/aqua cards over neutral white, anchored by a charcoal navigation surface and rounded linear icons.
- Avoid: glassmorphism, random color assignment, decorative dashboard filler, childish sticker-market visuals, one-radius-for-everything.
- Distinctive: purposeful color families, large-radius task/event cards, small geometric category markers, high-contrast black primary actions.
- Quiet: data storage, sync metadata, secondary labels and destructive controls.

## 4. Reference synthesis

### Mobile references 1–3 — primary

- Transfer: charcoal floating bottom dock, white central action, 26–30px task cards, lime/lilac/charcoal task states, capsule filters, circular date states, generous 16–20px gutters.
- Do not transfer: avatar/team concepts, fake review counts, decorative notches that reduce list density.
- Substitution: recurring/status/category metadata replaces team/review content.

### Mobile references 4–5 — calendar and agenda

- Transfer: clear time rail, soft-colored event blocks, black current-time marker, week strip, 16–22px event radius.
- Substitution: untimed tasks live in an all-day rail; timed calendar events align to their local hour.

### Reference 6 — markers

- Transfer: a restrained set of flower/star/diamond/spark/squircle geometric markers.
- Constraint: markers use the same six semantic color tokens and never carry random illustrations.

### Desktop references 7–8 — density

- Transfer: persistent navigation rail, expanded main calendar, clear view toolbar, large readable cells, selected-day side panel, dense but calm event chips.
- Do not transfer: fake teams, profiles, search fields without real behavior, background photography.

## 5. Theme system

All themes define a complete role set: background, surface, ink, muted, dock, primary, secondary, tertiary, task, plan, shopping, browse, success and border.

1. `violet-lime` (default): lilac `#aaa3df`, lime `#c8dc7b`, ice `#d9eef1`, charcoal `#222421`.
2. `aqua-garden`: aqua `#8bdde1`, leaf `#b8df8a`, violet `#c0b9e8`, deep green dock `#19302b`.
3. `mono-green`: warm white/charcoal base with moss `#b8d36a`, sage `#dce8c5`, cool white cards.
4. `soft-mix`: lilac, blush, butter and aqua over a warm-neutral canvas.

Category and item colors remain symbolic (`gray`, `blue`, `green`, `orange`, `pink`, `purple`) so every saved choice remaps harmoniously when the global theme changes.

## 6. Typography

- Family: system-first rounded grotesk stack for reliable CJK rendering; no remote font dependency.
- Page title: 30–36px mobile, 34–42px desktop, 650–700, tight tracking.
- Section heading: 18–22px, 650.
- Task/event title: 16–19px, 600.
- Body: 15–16px, 1.4–1.55 line-height.
- Labels: 12–13px, 500; never below 11px.
- Dates and counts: tabular numerals.

## 7. Component styling

- Navigation dock: charcoal 24–28px radius, inset from phone edges, 68px content height plus safe area; round-line icons at 2px stroke; center add button is white/black.
- Desktop navigation: 252px rail, neutral surface, rounded active rows; date/context card at top, settings/search at bottom.
- Primary cards: 24px radius, no visible border, colored background; 16–18px internal padding.
- Secondary containers: 20px radius, soft neutral fill, subtle 1px tinted border only when needed.
- Inputs: 16–18px radius, 48px minimum height, neutral fill; focused ring uses theme primary.
- Filters: 999px capsules, 44px minimum touch height.
- Task rows: independent cards with category/item color, marker, title, compact metadata and round completion control.
- Calendar cells: 14–18px radius on mobile; desktop month cells are large rectangular surfaces with readable event chips.
- Editors: 26px mobile bottom sheet / 24px desktop panel; no input auto-focus.
- Empty states: one geometric marker, direct text and optional single action; no invented metrics.

## 8. Marker system

- Shapes: `dot`, `flower`, `star`, `diamond`, `spark`, `squircle`.
- Rendering: one reusable SVG/CSS component, rounded corners/joins, no emoji.
- Color: only the theme-aware six-token palette.
- Inheritance: task/event uses its own optional marker/color, otherwise category marker/color, otherwise page default.
- Backward compatibility: existing records without marker or visual token render with deterministic defaults.

## 9. Layout principles

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40.
- Mobile gutters: 16px; narrow phones: 12px.
- Desktop container: up to 1480px; content uses available space rather than a mobile-width column.
- Desktop plan: calendar workspace plus 320–360px selected-day rail.
- Mobile plan: month/week/agenda modes; week board horizontally scrolls rather than shrinking text.
- Breakpoints: 640px form restructuring, 900px browse/layout changes, 1024px desktop shell, 1280px expanded calendar density.

## 10. Motion and interaction

- Hover/focus: 160–180ms; press scale 0.97–0.98.
- Card/page entry: 280–360ms, 18–30ms limited stagger.
- Sheets: 360ms mobile rise, 400ms desktop slide.
- Use transform and opacity; no layout animation on every element.
- Respect reduced motion and slow-update devices.
- Minimum touch target: 44×44px.

## 11. Implementation mapping

- Core tokens/layout: `src/index.css`, `src/App.tsx`.
- Themes: `src/lib/themes.ts`, `src/pages/Settings.tsx`, synced preferences.
- Markers: `src/components/MarkerIcon.tsx`, category/task/event optional fields.
- Icons: expand `src/components/AppIcon.tsx` and replace text glyph controls.
- Task cards: `src/components/TaskRow.tsx`, `src/pages/Today.tsx`.
- Calendar: `src/pages/Plan.tsx`, editors and event/task helpers.
- Category customization: `src/pages/Browse.tsx`, `src/lib/categories.ts`.
- Shopping: `src/pages/Shopping.tsx`.

## 12. Evaluation plan

- Build, lint and unit tests.
- Browser checks at 320×568, 390×844, 430×932, 1024×768, 1440×1000 and 1728×1117.
- Verify all four themes, marker/color persistence, long CJK titles, reduced motion, keyboard viewport and offline reload.
- Re-run task recurrence, calendar editing, batch add, shopping, drag sorting and PWA update tests.
