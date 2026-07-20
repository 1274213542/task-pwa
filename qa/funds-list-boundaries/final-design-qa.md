# Funds, grouped lists, swipe actions, and timeline QA

Date: 2026-07-20 (Asia/Tokyo)

## Scope

- Shopping grouped-list boundary ownership, light swipe, full-swipe deletion, and undo.
- Finance fund-pool amount definitions, archive/restore/delete lifecycle, editing, and quick-entry impact preview.
- Plan Time unscheduled grouped list, long-press scheduling, and week navigation controls.
- Shared structural dividers for task, completed-record, work-record, finance-ledger, and category lists.

## Automated checks

- `npm test`: 23 files, 123 tests passed.
- `npm run lint`: passed with no findings.
- `npm run build`: passed; PWA service worker generated with 46 precached entries.
- `git diff --check`: passed.

## Interaction QA

Test environment: isolated desktop Chromium at a 500 x 757 CSS viewport through browser-harness. This is not an iPhone or an iOS simulator.

### Shopping

- A stationary item exposes no duplicate visible ellipsis button.
- A light horizontal swipe reveals only More and Delete.
- Opening a second row closes the first row.
- The structural divider moves with the foreground and fades according to drag progress.
- Full swipe removes the row and shows an undo toast above the bottom navigation.
- Undo restores the original item identity and clears the transient commit transform.

Evidence:

- `/tmp/task-pwa-shopping-light-swipe-v2.png`
- `/tmp/task-pwa-shopping-divider-fade.png`
- `/tmp/task-pwa-shopping-full-swipe-deleted.png`

### Plan Time

- Unscheduled tasks render as flat rows inside one outer rounded panel.
- The persistent development hint was removed.
- Holding for 300 ms and dragging an unscheduled task displays target-time feedback and schedules it on release.
- The item moves from the unscheduled group to the scheduled timeline and persists through the existing update/sync path.
- Previous and Next are 44 x 44 circular buttons; Today is a separate 64 x 44 pill.

Evidence:

- `/tmp/task-pwa-plan-time-unscheduled.png`
- `/tmp/task-pwa-plan-time-dragged.png`
- `/tmp/task-pwa-plan-week-controls-final.png`

### Finance funds

- With an actual account balance of JP¥100,000, allocating JP¥30,000 leaves actual assets unchanged, changes unallocated funds to JP¥70,000, and changes allocated funds to JP¥30,000.
- Edit opens the editor with existing values; the currency is locked for an existing pool.
- Archive removes the pool from new allocations but preserves its balance in allocated totals.
- Restore returns the same pool record and balance.
- Delete remains disabled for a non-zero pool.
- A JP¥5,000 quick-entry expense previews the exact account delta, pool delta, spending-stat effect, and disposable-funds delta.
- Saving changes actual assets once to JP¥95,000, changes the pool to JP¥25,000, records JP¥5,000 used, and creates one expense transaction.

### Offline/PWA

- The generated service worker controls the locally served production build.
- After stopping the server and reloading, the shell and IndexedDB-backed finance balance still load from the service worker/cache.
- Restarting the preview server restores online loading without data loss.

## Visual review

- Group containers own their outer border and clipping.
- Resting child rows are flat; only the active swipe/drag row gains an elevated rounded surface.
- Legacy pseudo-element separators are suppressed where structural dividers are now used.
- The task toolbar uses two independent circular action buttons and one central segmented pill, without an additional frame around all three controls.

## Device limitations

- Real iPhone Safari and installed standalone PWA were not remotely controllable from this environment.
- Safe-area behavior, reduced-motion on/off, background resume, touch drag arbitration, and offline launch still require real-device confirmation after deployment.

final result: passed
