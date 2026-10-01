# Project Kanban for Super Productivity

An opt-in Kanban view **inside each project** in [Super Productivity](https://github.com/super-productivity/super-productivity). It is a separate plugin view, not a replacement for the app's Boards feature. Lanes are backed by tags; tasks stay scoped to their project.

> Early release: test on a disposable project before using important task data. The 0.2.x changes still need hands-on testing in Super Productivity.

## Install

Requires Super Productivity **18.7.0 or newer** (developed against the published plugin API and tested locally with 19.1.0).

1. **[Download project-kanban.zip from the latest release](https://github.com/Hendrik240298/superprod-kanban/releases/latest/download/project-kanban.zip)**. Do not unzip it.
2. In Super Productivity, open **Settings → Plugins → Choose Plugin File** and select the ZIP.
3. Open a project and use **List / Kanban** in its project header. The selected view is remembered per project.

There is also a build artifact on every successful [CI run](https://github.com/Hendrik240298/superprod-kanban/actions/workflows/release.yml), but GitHub requires sign-in for artifacts and they expire. The Release ZIP is the stable, direct download.

## Use

Choose a template under **Configure lanes**:

| Template | Lanes | Completed tasks |
| --- | --- | --- |
| Classic | To Do, In Progress, Done | Shown in Done (real task completion, not a tag) |
| Workflow | Clarify, Backlog, This Week, Doing, Waiting, Scheduled, Maybe/Later | Hidden from this board, not deleted |

To Do/Clarify is the fallback for unfinished tasks without a configured lane tag. The remaining Workflow lanes are **ordinary tags**: moving a task into the Scheduled lane does *not* schedule it in Super Productivity. Switching templates preserves each template's project-specific lane configuration. Tags themselves are shared across the app; the Workflow template reuses matching tag names or creates them when first selected.

In **Configure lanes**, add or create tags, give lanes local display names, reorder tag lanes, or remove them without deleting tasks or tags. To Do/Clarify stays first, and Done stays last in Classic.

Drag cards between lanes, or above/below another card to reorder tasks inside a lane. This order is stored by the plugin per project and template; it does not reorder the native task list. The **⋯** menu offers a Move to selector for keyboard/touch use (and Complete in Workflow). Click a card title to open native task details. When present, a right-aligned calendar/date (or clock/time for today) and time estimate follow the app's Boards card style; hover the schedule for its full date and time. Subtasks appear, but must be moved from their parent/native details.

## Build from source

Requires Python 3 and Deno 2. From the **repository root**:

```sh
deno fmt --check src/ tests/
deno check src/board-core.js src/board-ui.js src/plugin.js
deno test --allow-read tests/
python3 build.py
```

Install `dist/project-kanban.zip` using the instructions above. The ZIP contains `manifest.json`, `plugin.js`, and a self-contained `index.html` at its root. The [CI workflow](.github/workflows/release.yml) runs these checks on pushes and pull requests, uploads a short-lived build artifact, and publishes the ZIP as a GitHub Release when a version tag such as `v0.2.2` is pushed. Tags must match `src/manifest.json`'s version.

## Verify on a disposable project

1. Make projects A and B. Choose Kanban for A and leave B on List. Switch A → B → A and restart; both should retain their views.
2. Add a task in each lane of A and verify every task belongs to A rather than Inbox/B. Move an existing task with an unrelated tag through each lane and check the tag survives; Done must actually complete it.
3. Create another lane from a tag, rename its **local label**, reorder it, and remove it. Check tasks remain visible in the fallback lane and the global tag name remains unchanged. Try dragging two tasks within a lane and reopening the board to verify their order.
4. Check a project with backlog items and subtasks; both are identified, and the native task detail still opens.
5. Set an all-day schedule, a timed schedule, and a time estimate in native task details; check the board card chips and updates after editing the task.

## Limits

- The embedded iframe uses its own styled cards, not the app's internal Angular Boards component.
- It does not expose sections, duplicate Boards, or reorder the app's native task list. When no plugin-specific order exists, cards follow the order returned by the plugin task API.
- The tag-based lane model treats completed tasks as Done even when they retain tags from outside the plugin. Moving a card with multiple configured lane tags resolves the conflict by removing the *configured* lane tags; unrelated tags remain.
- Integration with a real running Super Productivity instance still needs the manual checks above. Automated tests cover pure lane rules, a mocked iframe flow, and host preference logic; they are not a substitute for app testing.

The project background and design decisions are in [IDEA.md](IDEA.md) and [PLAN.md](PLAN.md). Licensed under [MIT](LICENSE).
