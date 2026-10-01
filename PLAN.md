# Project Kanban: design and implementation plan

Status: the tag-based plugin is implemented in `src/`; screenshots confirm the board renders, and the user verified task creation and cross-lane dragging in the running app. The user has used the board at work and likes it. Versions 0.4.0–0.4.2 streamlined quick add, removed the redundant card menu, and added a view-toggle shortcut. Version 0.5.0 adds Vim-style board navigation and keyboard completion; v0.6.0 adds `e` for inline title editing and Shift+H/J/K/L to move cards. Native task-row shortcuts remain unavailable while the iframe has focus. These changes and cross-project/restart persistence still need manual verification. This plan expands [IDEA.md](IDEA.md).

## Goal and scope

Give every Super Productivity project an opt-in List / Kanban toggle. The Kanban view is scoped automatically to the active project, so creating tasks and switching projects never require editing a project's filter in each lane. Each project remembers its preferred view and its lane configuration. The plugin should look at home beside the built-in Boards UI, but is a separate view.

First release: tag-based lanes only. Do not attempt to turn project sections into lanes, auto-generate built-in Boards, patch app internals, or reproduce every feature of the existing Boards screen.

## Agreed behaviour

1. **View switching:** A project-header control opens Kanban or returns to the normal task list. Changing projects loads that project's own List / Kanban preference; a project set to List must not inherit another project's Kanban view. Prefer List by default for projects without a saved preference. Remember preferences after restart/sync if the plugin's persistence supports it.
2. **Project scoping:** Read the active project's ID; display only its tasks. Inline creation always supplies that ID explicitly, including for an unassigned lane. Do not rely on a lane's tag or the current route to choose a project.
3. **Initial lanes:** To Do (undone tasks without a configured lane tag), In Progress (undone tasks with the configured In Progress tag), Done (tasks with `isDone`, regardless of lingering tags). Provide an Unassigned fallback for unfinished tasks that do not match a configured tagged lane as the configuration evolves; do not hide existing tasks. The default To Do lane can serve as that fallback initially.
4. **One lane per task:** Lane membership is deterministic and exclusive. A drop removes *other configured lane tags*, adds the target lane's tag if any, and preserves unrelated tags. Moving to Done sets `isDone` and removes configured lane tags; moving out of Done clears `isDone`. If a pre-existing task carries several configured lane tags, display it once in the first matching lane by configured order; normalize its lane tags only when the user moves it, not merely by viewing it.
5. **Flexible lanes:** Let a project select existing tags as additional lanes, give lanes local display labels, and reorder lanes. Default each tag lane's label to the tag's current name; store optional per-project label overrides separately from tag IDs. Make removing a lane non-destructive: tasks keep their tags and remain visible in the fallback lane until reassigned. Never rename or delete a global tag merely because a lane label changes.
6. **Task interaction:** At minimum show title and completion state, create a task in a lane, move it between lanes, and open its native task detail panel. Preserve native task IDs and data. Advanced card actions, subtasks, backlog integration, keyboard navigation, sorting, and within-lane manual order can follow after the basic workflow is reliable.
7. **Look and feel:** Match the existing board's visual conventions using supported plugin theme variables and a self-contained iframe UI. Do not import private Angular components or manipulate the host DOM to reuse Boards code.

The special lanes (To Do/Unassigned and Done) have behaviour beyond a tag filter. When implementing flexible lanes, keep these semantics explicit rather than pretending every column is just a tag. Lane-label overrides are local aliases; global tags remain unchanged.

## Feasibility and boundaries

The published [plugin API types](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts) include a project-scoped header button, `getActiveWorkContext()`, `showInWorkContext()` / `closeWorkContextView()`, task and tag reads/writes, `selectTask()`, hooks for context/task changes, and synced plugin persistence. The [plugin development guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md) documents a host-side `plugin.js` plus an iframe `index.html` for custom UI and theme styling. Together these support a tag-based project view in principle, subject to the installed app version and a small working prototype.

Important constraints:

- The embed is managed by the host as one plugin work-view slot, not a native per-project view setting. The plugin must coordinate its per-project List/Kanban preferences on context changes and close the embed for List projects. Confirm this behaviour in the installed version, including navigation away and back.
- The built-in [Boards implementation](https://github.com/super-productivity/super-productivity/blob/master/src/app/features/boards/board-panel/board-panel.component.ts) is internal app code. The plugin cannot reuse its Angular components or programmatically create/configure Boards through the supported API. Its own card/column UI requires implementation and testing.
- Sections are separate state; the published plugin API does not expose supported section reads/moves. Section lanes would need an upstream API addition or an app feature, not an unsafe store/DOM workaround.
- `getTasks()` gives a snapshot, not a live subscription; refresh on relevant hooks and on entering a project. Use project ID as the scoping key, not project title. Verify completed-task visibility and the treatment of backlog tasks on a disposable test project.
- Plugins should only be tested with disposable data first. Keep settings small (view preference and lane IDs/order per project); Super Productivity remains the source of truth for tasks and tags. Do not duplicate task membership in plugin persistence.

## Implementation order and status

1. **Compatibility spike:** Installed app package reports 19.1.0; the ZIP builds with a project-only header toggle and embedded iframe. Automated host tests cover preference switching. **Still verify in the running app** with two disposable projects.
2. **Read-only board:** Implemented current-project To Do / In Progress / Done columns, unassigned/conflicting-tag fallback, backlog and subtask indicators, and hook-triggered refresh. **Still verify rendering in the app.**
3. **Core editing:** Implemented project-aware task creation, native detail opening for completion and other task edits, and cross-lane moves by dragging. Unit tests cover tag preservation and project scoping; **still verify host mutations in the app.**
4. **Per-project configuration:** Implemented keyed synced view/lane preferences, tag selection and creation, lane aliases and ordering, and non-destructive removal. **Still verify persistence after restart/sync.**
5. **Polish and release:** Basic responsive board styling and plugin-local task ordering within a lane are included. The redundant ⋯ menu was removed in v0.4.1; clicking or keyboard-activating a card opens native task details, `e` edits its title inline, and dragging or Shift+H/J/K/L handles lane changes and ordering on the board. The board's embedded toolbar only shows Configure lanes; the host project header provides view switching. Task cards show schedule and estimate indicators from native task data. The inline task form is a single keyboard-first field with transient suggestions and deterministic parsing, rather than the host's internal natural-language parser. The classic and seven-lane workflow templates are stored per project; the latter hides completed tasks and uses tag lanes, not native backlog/scheduling. Further accessibility, edge-case and real-app testing remains.

## Acceptance checks for a first usable version

- In project A, switch to Kanban; in project B, leave List selected. Switching A → B → A shows the correct view each time, including after restarting the app.
- A task created in any lane of A has `projectId` for A; it is not sent to Inbox or B. Its lane assignment and completion state agree with the destination lane.
- Dragging or otherwise moving a task between lanes results in exactly one visible card and retains non-lane tags. Done marks the task complete; moving it back reopens it.
- Existing tasks without lane tags, with stale lane tags, or carrying two lane tags remain visible exactly once; removing a configured lane does not delete tags or tasks.
- A project's lane arrangement does not alter another project's arrangement; changing a lane label does not rename a global tag without an explicit separate action.
- The normal task list remains available, and tasks edited in either view appear correctly in the other after refresh.
- Cards can be reordered within a lane by dragging above/below another card; order survives reopening without rewriting Super Productivity's native task-list order.
- Switching between Classic and Workflow preserves each template's configured lanes. Workflow has seven lanes, with Clarify as the untagged fallback, six tag lanes, and no Done column; completed tasks remain in the underlying project.

## Decisions deferred until the compatibility spike

- Installed Super Productivity version and minimum supported plugin version.
- Whether projects should share one default tag-lane template initially; local label aliases are part of configurable lanes, but can follow the core three-lane workflow.
- How to handle backlog and subtasks in the first board (show, exclude explicitly, or defer with a visible explanation); do not silently drop them.
- Workflow template chosen for the second preset: Clarify as the untagged fallback, six tag lanes, and no Done lane (completed tasks hidden). Classic retains To Do and Done. Both templates are configurable per project.
