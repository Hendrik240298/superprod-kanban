# Project Kanban for Super Productivity

An opt-in Kanban view **inside each project** in [Super Productivity](https://github.com/super-productivity/super-productivity). It is a separate plugin view, not a replacement for the app's Boards feature. Lanes are backed by tags; tasks stay scoped to their project.

> Early release: test new features on a disposable project before using important task data. The keyboard-first task entry still needs hands-on testing in Super Productivity.

## Install

Requires Super Productivity **18.7.0 or newer** (developed against the published plugin API and tested locally with 19.1.0).

1. **[Download project-kanban.zip from the latest release](https://github.com/Hendrik240298/superprod-kanban/releases/latest/download/project-kanban.zip)**. Do not unzip it.
2. In Super Productivity, open **Settings → Plugins → Choose Plugin File** and select the ZIP.
3. Open a project and use **List / Kanban** in its project header. The selected view is remembered per project.

For a keyboard toggle, go to **Settings → Keyboard** and assign `Ctrl+Alt+K` to **Toggle project List / Kanban** under Plugin Shortcuts. The app controls the binding; the plugin cannot set it automatically. While focus is inside the Kanban board, the same `Ctrl+Alt+K` chord closes it (unless you are typing in a field). The shortcut only toggles in project contexts.

There is also a build artifact on every successful [CI run](https://github.com/Hendrik240298/superprod-kanban/actions/workflows/release.yml), but GitHub requires sign-in for artifacts and they expire. The Release ZIP is the stable, direct download.

## Use

Choose a template under **Configure lanes**:

| Template | Lanes | Completed tasks |
| --- | --- | --- |
| Classic | To Do, In Progress, Done | Shown in Done (real task completion, not a tag) |
| Workflow | Clarify, Backlog, This Week, Doing, Waiting, Scheduled, Maybe/Later | Hidden from this board, not deleted |

To Do/Clarify is the fallback for unfinished tasks without a configured lane tag. The remaining Workflow lanes are **ordinary tags**: moving a task into the Scheduled lane does *not* schedule it in Super Productivity. Switching templates preserves each template's project-specific lane configuration. Tags themselves are shared across the app; the Workflow template reuses matching tag names or creates them when first selected.

In **Configure lanes**, add or create tags, give lanes local display names, reorder tag lanes, or remove them without deleting tasks or tags. To Do/Clarify stays first, and Done stays last in Classic.

Drag cards between lanes, or above/below another card to reorder tasks inside a lane. This order is stored by the plugin per project and template; it does not reorder the native task list. Click anywhere on a card (or focus it and press Enter/Space) to open native task details for tags, scheduling, estimates and completion. To move a task to a different tag lane from the sidebar, remove its old lane tag as well as adding the new one; drag-and-drop handles this automatically. When present, a right-aligned calendar/date (or clock/time for today) and time estimate follow the app's Boards card style; hover the schedule for its full date and time. Subtasks appear, but must be moved from their parent/native details.

Native task-row shortcuts such as `Shift+T` (move the focused task to Today) are not available while the Kanban iframe has focus: its cards are not native task rows. Use native task details or switch back to List for those actions. The plugin does not forward native task-row shortcuts into the iframe.

**Keyboard navigation on the board:** Focus a card, then use `j`/`k` for the next/previous card in its lane, `h`/`l` for the nearest card in the previous/next nonempty lane, and `gg`/`G` for the first/last card in the lane. Hold Shift with `H`/`L` to move the card one lane left/right (including empty lanes), or with `K`/`J` to reorder it up/down within its lane. Moves update lane tags and completion like dragging; subtasks still need native task details. Enter/Space opens native task details. Press `e` to edit the card’s title in place: Enter saves, Escape cancels, and focus returns to the card. This edits only the literal title; `#`/`@` quick-add shortcuts are not parsed again. `a` or `i` focuses that lane’s add input; Escape returns to the card (if autocomplete is open, press Escape twice). `d` toggles completion of the focused card; in Workflow, completing it hides it from the board. Press `?` for a small on-demand reminder. These keys work only inside the board and never while typing in a field or editing lane settings. Focus is restored after board refresh when possible, and after adding a task it returns to that lane’s input. Native shortcuts such as `Shift+T` are still not forwarded into the iframe.

**Add tasks in a lane:** Use the single input and press Enter. Shortcuts remain visible and editable in the input until you submit:

- `#` suggests existing non-lane tags: `Write report #Extra`. Select with ↑/↓ and Enter, or type the exact name. Tags with spaces are inserted as `#"Focus Time"`.
- `@` suggests common dates/times: `Review @tomorrow`, `Follow up @in 1 hour`, `Meet @2026-10-22 14:30`. Supported suggestions include today, tomorrow, next week, weekdays, tonight, and a few relative/clock times. Exact `@YYYY-MM-DD` dates work without selecting a suggestion.
- Type an estimate with a unit: `Write report 45m` or `Write report 1h 30m`. Duration suggestions appear after typing a unit; choose with ↑/↓ and Enter. Custom durations with `h`/`m` work without selecting a preset.

Enter accepts a visible suggestion; press Enter again to create the task. Escape closes suggestions. You can also submit using the Add button. The shortcuts are stripped from the created title, while the task stays in the active project and the lane where it was entered. Unsupported `@` expressions and unknown `#` tags show an error rather than silently creating the wrong task. The full native natural-language parser, repeat rules (including `@every ...`), and creating new tags from this form are not available inside the plugin iframe.

## Build from source

Requires Python 3 and Deno 2. From the **repository root**:

```sh
deno fmt --check src/ tests/
deno check src/board-core.js src/board-ui.js src/plugin.js
deno test --allow-read tests/
python3 build.py
```

Install `dist/project-kanban.zip` using the instructions above. The ZIP contains `manifest.json`, `plugin.js`, and a self-contained `index.html` at its root. The [CI workflow](.github/workflows/release.yml) runs these checks on pushes and pull requests, uploads a short-lived build artifact, and publishes the ZIP as a GitHub Release when a version tag such as `v0.6.0` is pushed. Tags must match `src/manifest.json`'s version.

## Verify on a disposable project

1. Make projects A and B. Choose Kanban for A and leave B on List. Switch A → B → A and restart; both should retain their views.
2. Add a task in each lane of A and verify every task belongs to A rather than Inbox/B. Move an existing task with an unrelated tag through each lane and check the tag survives; Done must actually complete it.
3. Create another lane from a tag, rename its **local label**, reorder it, and remove it. Check tasks remain visible in the fallback lane and the global tag name remains unchanged. Try dragging two tasks within a lane and reopening the board to verify their order.
4. Check a project with backlog items and subtasks; both are identified, and the native task detail still opens.
5. Set an all-day schedule, a timed schedule, and a time estimate in native task details; check the board indicators and updates after editing the task.
6. In a lane's single input, type `Write report #Extra @2026-10-22 14:30 1h 30m` (with an existing unrelated tag), then submit. Check that the title is `Write report`, the task stays in this project/lane, and native details show the tag, timed schedule, and estimate.
7. Type `@tom` and select tomorrow with Enter, then press Enter again to add the task. Try `@in 1` for a timed suggestion. Verify typing `@every friday` or an unknown `#` tag fails visibly rather than creating a task.
8. Click a card and press Enter/Space on a focused card; each should open native task details without a separate ⋯ menu. Change its tags or mark it complete there and verify the board refreshes.
9. Assign `Ctrl+Alt+K` to the plugin shortcut in Keyboard Settings, toggle into Kanban from List, then use the same chord while focused on a card to return to List. Typing in the inline task field should not trigger the board shortcut.
10. Focus a card and use `j/k`, `h/l`, `gg/G`, `a` (or `i`), Escape, `d`, and `?`. Verify navigation follows the visible card order, input typing is unaffected, and completing a card refreshes the board without losing keyboard focus.
11. Focus a card, press `e`, rename it and save with Enter; try Escape to cancel and an empty title to confirm it is rejected. Check native task details show the new title. Use Shift+J/K to reorder it within the lane and Shift+H/L to move it between lanes, including an empty lane; verify focus and unrelated tags survive.

## Limits

- The embedded iframe uses its own styled cards, not the app's internal Angular Boards component.
- It does not expose sections, duplicate Boards, or reorder the app's native task list. When no plugin-specific order exists, cards follow the order returned by the plugin task API.
- The tag-based lane model treats completed tasks as Done even when they retain tags from outside the plugin. Moving a card with multiple configured lane tags resolves the conflict by removing the *configured* lane tags; unrelated tags remain.
- Cards can be moved and reordered with Shift+H/J/K/L or by dragging. Subtasks still need native task details for moves, and these board-local keys do not change the app's native task-list order.
- Timed scheduling uses a second API call after creating the task. If that call fails, the task still exists; the board reports the failure and you can schedule it in native task details.
- Integration with a real running Super Productivity instance still needs the manual checks above. Automated tests cover pure lane rules, a mocked iframe flow, and host preference logic; they are not a substitute for app testing.

The project background and design decisions are in [IDEA.md](IDEA.md) and [PLAN.md](PLAN.md). Licensed under [MIT](LICENSE).
