# Task hierarchy v2 — implementation decision

## Decision

The app keeps one `tasks` table and one relationship field, `parentTaskId`.
An optional `nodeRole` distinguishes an executable `task` from an
organizational `plan`. Missing values are read as `task`, so existing rows and
older synchronized devices remain readable without a schema migration.

This deliberately avoids a second plan table and avoids copying a task into
the task list, plan group, and timeline. Those screens remain projections of
the same source task and completion records.

## User model

- A **task** can be completed, scheduled, repeated, placed on the timeline,
  and optionally broken into executable child tasks.
- A **plan** only organizes tasks. It has no checkbox, recurrence occurrence,
  completion record, task-count contribution, or timeline row.
- An executable task may still be a parent. This represents a deliverable
  such as “完成作品集” that is itself completable.
- “所属计划” is the ordinary UI. Executable parent selection and schedule
  inheritance live under “父任务高级设置”. Both reuse `parentTaskId`, so a task
  cannot accidentally acquire two competing owners.

## Creation paths

### Quick capture

1. Enter one or more lines.
2. Optionally prefix a line with a local time (`8.00`, `08:30`, `9：00`).
3. Optionally choose or create one plan.
4. Choose the date; advanced fields stay collapsed.
5. Validate all lines, then create the plan and task rows in one Dexie
   transaction. Any invalid line prevents the whole batch from being written.

Lines without a time remain on the selected date’s unscheduled section. Lines
with a time use `YYYY-MM-DDTHH:mm` and appear on that date’s timeline.

### Full editor

The first half contains title, ownership, scheduling, recurrence, and
relationship. Category, status, notes, display rules, and visual markers stay
under “更多设置”. Plans omit completion and recurrence controls.

## Schedule and relationship rules

- New parent relationships default to `inheritsParentSchedule: false`.
- Legacy rows without the flag keep the historical inherited behavior.
- Selecting a plan never locks a child’s own time.
- Candidate parents exclude the task itself and all descendants.
- A plan cannot be nested in this first phase; executable tasks may nest.
- Deleting a plan or parent first materializes every direct child’s effective
  schedule, then detaches the child and soft-deletes the parent. Tasks survive.
- Plan progress is derived from executable leaf descendants and the current
  projected occurrences, never from “this task id completed at some point”.

## Recurrence and timeline

The existing recurrence model remains canonical. A recurring executable task
may belong to a plan, but its deterministic occurrence id and completion
record are unchanged. Plans themselves never recur. The calendar projection
skips plans; the timeline reads the effective task schedule and can show a
small plan label without grouping or duplicating rows.

## Compatibility and rollback

- No Dexie schema version is required because `nodeRole` is optional and is
  not indexed.
- Old rows read as executable tasks.
- Old parent inheritance remains intact.
- No existing parent is auto-converted into a plan.
- Removing `nodeRole` from newly created plan rows is a reversible data-level
  rollback; existing task and completion ids are unchanged.
- An older client can read the new row shape but may temporarily render a plan
  as a normal task until it reloads the current PWA. Service-worker activation
  and deployment smoke tests therefore remain release requirements.

## Deferred decisions

- Nested organizational plans.
- Converting an existing executable parent into a plan in bulk.
- A dedicated plan detail screen.

These remain deferred until real usage demonstrates a need; none requires a
new storage entity in the current model.
