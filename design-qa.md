# System UI structure cleanup — design QA

## Sources compared

- User iPhone screenshots: shopping grouped/flat, finance overview/accounts/funds/ledger, category records, and Plan time view.
- Current production build rendered at a 390 × 844 CSS viewport in isolated desktop Chromium through browser-harness.
- Side-by-side and 50% overlays:
  - `qa/system-ui-structure-cleanup/shopping-reference-current-overlay.jpg`
  - `qa/system-ui-structure-cleanup/finance-accounts-reference-current-overlay.jpg`
  - `qa/system-ui-structure-cleanup/plan-reference-current-overlay.jpg`

The automated viewport is not labelled as an iPhone or Safari result. The user screenshots include the iOS status bar while the Chromium captures begin at the web viewport, so top offsets are judged from the app content origin rather than the physical screen edge.

## Visible corrections verified

- Shopping groups own one rounded shell; normal product rows are flat and use one moving divider.
- Empty shopping rows no longer render a nested rounded surface; the drop target is introduced only during an active drag.
- Category management owns one rounded shell; the category row and composer no longer repeat that radius.
- Finance ledger rows no longer duplicate the external-payment label or expose permanent edit/delete controls.
- Finance accounts render as one grouped list; management controls are disclosed on demand rather than forming a four-column button wall.
- External accounts show their supported original currencies and no longer imply a personal zero balance.
- Fund-pool rows separate identity, available/used/reserved values, and management actions.
- Plan week strip and unscheduled list now own separate single boundaries; the shared wrapper is transparent.
- Unscheduled tasks are flat rows with exactly one divider; only the dragged row is elevated.
- The week-range controls use two circular arrows plus one independent Today pill with stable spacing.
- Mobile bottom navigation remains one persistent floating surface with safe scrolling space.

## Interaction and data checks

- Long-press scheduling: 300 ms hold entered drag state; moving the row changed the target from 09:00 to 10:15; release persisted the time; reload retained it.
- External payer currency: an external account enabled for JPY/CNY accepted a CNY expense while personal assets stayed unchanged.
- Missing conversion rate: the original CNY transaction remained visible and the JPY overview displayed an explicit missing-rate explanation instead of silently presenting the value as converted.
- Service-worker controlled reload succeeded with network requests emulated offline and retained the local finance data.
- `npm run lint`, `npm test -- --run`, and `npm run build` passed.

## Remaining device-only checks

- Real iPhone Safari and installed standalone PWA safe-area measurements.
- Native touch competition between long-press scheduling, swipe actions, and momentum scrolling.
- Backdrop-filter appearance under real iOS compositing and Reduce Motion settings.

final result: passed
