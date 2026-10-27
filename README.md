# Project Kanban for Super Productivity

An opt-in Kanban view **inside each project** in [Super Productivity](https://github.com/super-productivity/super-productivity). It is a separate plugin view, not a replacement for the app's Boards feature. Lanes are backed by tags; tasks stay scoped to their project.

> Early release: test new features on a disposable project before using important task data. The keyboard-first task entry still needs hands-on testing in Super Productivity.

## Install

Requires Super Productivity **18.7.0 or newer** (developed against the published plugin API and tested locally with 19.1.0).

1. **[Download project-kanban.zip from the latest release](https://github.com/Hendrik240298/superprod-kanban/releases/latest/download/project-kanban.zip)**. Do not unzip it.
2. In Super Productivity, open **Settings → Plugins → Choose Plugin File** and select the ZIP.
3. Open a project and use **List / Kanban** in its project header. The selected view is remembered per project.

For a keyboard toggle, go to **Settings → Keyboard** and assign `Shift+V` to **Toggle project List / Kanban** under Plugin Shortcuts. The app controls this binding; the plugin cannot set it automatically. Inside Kanban, `Shift+V` is mirrored when you are not typing, and `Ctrl+Alt+K` exits even from a text field (except when the key is used as AltGr). The iframe cannot read arbitrary bindings from Keyboard Settings: another assigned combination may work outside the board but not inside it. The toggle only works in project contexts.

There is also a build artifact on every successful [CI run](https://github.com/Hendrik240298/superprod-kanban/actions/workflows/release.yml), but GitHub requires sign-in for artifacts and they expire. The Release ZIP is the stable, direct download.

## Use

Choose a template under **Configure lanes**:

| Template | Lanes | Completed tasks |
| --- | --- | --- |
| Simple | Backlog, Doing | Hidden, not deleted |
| Workflow | Clarify, Backlog, This Week, Doing, Waiting, Scheduled, Maybe/Later | Hidden from this board, not deleted |

Simple uses the same **Backlog** and **Doing** tags as Workflow. Untagged tasks (including tasks left with the old In Progress tag) appear in Backlog; moving a card into either lane assigns that lane's tag. The old In Progress tag is not removed or bulk-migrated. Clarify is the Workflow fallback for unfinished tasks without a configured lane tag. The remaining Workflow lanes are **ordinary tags**: moving a task into the Scheduled lane does *not* schedule it in Super Productivity. Switching templates preserves Workflow's project-specific lane configuration. Tags themselves are shared across the app; matching tag names are reused or created on first use. Existing Classic settings and order are not deleted, but the former three-lane board now opens as Simple.

**Tag names for native task entry:** Workflow uses `This-Week` and `Maybe-Later`, displayed as “This Week” and “Maybe/Later” on the board. On first opening a project Kanban after upgrading, the plugin checks **all saved Workflow boards**, creates these tags if missing, and replaces legacy lane references (`This Week`, `Maybe/Later`) with the new tag IDs. It does **not** bulk-edit tasks, rename or delete global tags. Tasks that only have an old lane tag move to **Clarify**; drag them into the new lane to replace their old tag with the new one, keeping unrelated tags. Existing per-lane display labels are preserved. If an old and new lane were both configured, the duplicate becomes one new lane. Other preset tags (`Backlog`, `Doing`, `Waiting`, `Scheduled`) are unchanged. Custom tags with spaces may have the same native-entry issue; quoted `#"Focus Time"` is supported by this plugin's own input, not necessarily the native one. Use `#this-week` and `#maybe-later` in task entry. Super Productivity reserves `+` for its project shorthand, so `#maybe+later` cannot be parsed as one tag there.

In **Configure lanes**, select a template. For Workflow, you can also add or create tags, give lanes local display names, reorder tag lanes, or remove them without deleting tasks or tags. Clarify stays first. Simple's two lanes are fixed so they stay consistent with Workflow's tags.

Drag cards between lanes, or above/below another card to reorder tasks inside a lane. This order is stored by the plugin per project and template; it does not reorder the native task list. Click a card (or focus it and press Enter/Space) to open native task details. **Finish a task** with the small circle beside the first line of its title, or focus the card and press `d`: it disappears from Kanban but remains in the native task list. Right-click a card for a task-actions menu matching the shape of the native List menu. It is a **plugin-local recreation**, not the host's actual menu. To move a task to a different tag lane from the sidebar, remove its old lane tag as well as adding the new one; drag-and-drop handles this automatically. When present, a right-aligned calendar/date (or clock/time for today) and time estimate follow the app's Boards card style; hover the schedule for its full date and time. **Subtasks do not get separate cards**; their parent card retains the subtask-count chip, and opening the parent shows its subtasks in native task details.

**Right-click actions:** The top icons schedule for today/tomorrow, open List for native backlog movement, choose an all-day date, or clear the schedule. The rows move a card to the top/bottom of its **board-local** lane, create a subtask, set/clear an estimate, toggle non-lane tags, move to another project, or delete the task **and its subtasks** after explicit confirmation. With the menu open, `A` opens Add subtask, `T` Estimate, `G` Toggle tags, `E` Move to project, and `Backspace` the delete *confirmation*; none of these shortcuts delete immediately. Add subtask opens its native details after creation. For focus sessions, full duplication (including subtasks), and priority, the row is marked **List**: selecting it returns to List with the task selected, where you can use the native action. Recurring tasks also go to List for project moves, avoiding an unexpected move of every repeat instance. These fallbacks do not perform the named action automatically. The plugin cannot invoke the original host menu from an iframe. Menu colors and fonts use Super Productivity's injected theme tokens; reopen the board if a theme change is not reflected immediately.

Native task-row shortcuts such as `Shift+T` (move the focused task to Today) are not available while the Kanban iframe has focus: its cards are not native task rows. Use native task details or switch back to List for those actions. The plugin does not forward native task-row shortcuts into the iframe.

**Keyboard focus on the board:** On opening Kanban, the board itself is focused. Press `j` to focus the first card. From a card, Escape returns to board focus without leaving Kanban; `j` enters card navigation again. This is a focus distinction, not a switch back to the host: Super Productivity’s native shortcuts still do not reach the host while the iframe has focus. `Shift+V` returns to List from board/card focus; `Ctrl+Alt+K` also works while typing. In quick-add, Escape closes suggestions first, then returns to the card, then to board focus.

**Keyboard navigation:** Use `j`/`k` for the next/previous card in its lane, `h`/`l` for the nearest card in the previous/next nonempty lane, and `gg`/`G` for the first/last card in the lane. Hold Shift with `H`/`L` to move the card one lane left/right (including empty lanes), or with `K`/`J` to reorder it up/down within its lane. Moves update lane tags like dragging; subtasks still need native task details. Enter/Space opens native task details; `m` or Shift+F10 opens the card's actions menu (↑/↓ navigates it, Escape closes it). Press `e` to edit the card’s title in place: Enter saves, Escape cancels, and focus returns to the card. `#`, `@`, and duration suggestions also work here (for example, `Review @tomorrow`); selected shortcuts are removed from the title and applied to the task. Existing tags, schedule, and estimate remain unless you explicitly supply a replacement. To *remove* metadata, use native task details. `a` or `i` focuses that lane’s add input; `d` finishes the focused card. Press `?` for a small on-demand reminder. Navigation keys never act while typing in a field or editing lane settings. Focus is restored after board refresh when possible, and after adding a task it returns to that lane’s input.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `j` from board focus | Focus the first card |
| `j` / `k` | Next / previous card in the lane |
| `h` / `l` | Nearest card in the previous / next nonempty lane |
| `gg` / `G` | First / last card in the lane |
| `Shift+H` / `Shift+L` | Move the focused card to the previous / next lane |
| `Shift+K` / `Shift+J` | Move the focused card up / down in its lane |
| `d` | **Finish** the focused task (`isDone`); it disappears from both boards. Reopen it in List/native details to undo. |
| `m` / `Shift+F10` | Open the card's actions menu; ↑/↓ navigate, Enter selects, Escape closes |
| `Enter` / `Space` | Open the focused task in native details (including its subtasks) |
| `e` | Edit the focused card inline; Enter saves, Escape cancels |
| `a` / `i` | Focus that lane's quick-add input |
| `Escape` | From a card, return to board focus; in quick-add, close suggestions first |
| `?` | Show/hide the on-board shortcut hint |
| `Shift+V` | Return to List (when not typing; assign the same binding in Settings → Keyboard) |
| `Ctrl+Alt+K` | Return to List, including while typing (except AltGr) |

Keyboard navigation works within Kanban only, and does not intercept text typed in an input. Finishing a task does not delete it.

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

Install `dist/project-kanban.zip` using the instructions above. The ZIP contains `manifest.json`, `plugin.js`, and a self-contained `index.html` at its root. The [CI workflow](.github/workflows/release.yml) runs these checks on pushes and pull requests, uploads a short-lived build artifact, and publishes the ZIP as a GitHub Release when a version tag such as `v0.7.3` is pushed. Tags must match `src/manifest.json`'s version.

## Verify on a disposable project

1. Make projects A and B. Choose Kanban for A and leave B on List. Switch A → B → A and restart; both should retain their views.
2. Add a task in each lane of A and verify every task belongs to A rather than Inbox/B. Move an existing task with an unrelated tag through each lane and check the tag survives; press `d` to complete it and check it disappears while remaining in the native task list.
3. Create another lane from a tag, rename its **local label**, reorder it, and remove it. Check tasks remain visible in the fallback lane and the global tag name remains unchanged. Try dragging two tasks within a lane and reopening the board to verify their order.
4. Check a project with backlog items and subtasks; only parent cards are shown, each with a subtask count. Open the parent to see subtasks in native task details.
5. Set an all-day schedule, a timed schedule, and a time estimate in native task details; check the board indicators and updates after editing the task.
6. In a lane's single input, type `Write report #Extra @2026-10-22 14:30 1h 30m` (with an existing unrelated tag), then submit. Check that the title is `Write report`, the task stays in this project/lane, and native details show the tag, timed schedule, and estimate.
7. Type `@tom` and select tomorrow with Enter, then press Enter again to add the task. Try `@in 1` for a timed suggestion. Verify typing `@every friday` or an unknown `#` tag fails visibly rather than creating a task.
8. Click a card and press Enter/Space on a focused card; each should open native task details without a separate ⋯ menu. Change its tags or mark it complete there and verify the board refreshes.
9. Assign `Shift+V` to the plugin shortcut in Keyboard Settings, toggle into Kanban from List, then use the same chord while focused on a card to return to List. Inside text fields, typing capital V must not toggle; `Ctrl+Alt+K` should exit even there.
10. Focus a card and use `j/k`, `h/l`, `gg/G`, `a` (or `i`), Escape, `d`, and `?`. Verify navigation follows the visible card order, input typing is unaffected, and completing a card refreshes the board without losing keyboard focus.
11. Focus a card, press `e`, type `@tom`, accept `@tomorrow` with Enter, then press Enter again to save. Check the native due date changed without erasing existing tags or estimate; try `#` tags and a duration too. Escape cancels; an unsupported `@` expression must show an error without saving. Use Shift+J/K to reorder it within the lane and Shift+H/L to move it between lanes, including an empty lane; verify focus and unrelated tags survive.
12. From a focused card, press Escape to focus the board without leaving Kanban, then `j` to focus the first card. Repeat after quick-add and across board refreshes; other native app shortcuts will still require leaving the iframe.
13. Switch from an old Classic board to Simple: old In Progress cards should be visible in Backlog without any automatic tag changes. Move a card to Doing and check that its shared Doing tag is applied; completed tasks should not appear in either lane.
14. Right-click a card and try each supported action on a disposable project, including scheduling a previously timed task, creating a subtask, toggling a non-lane tag, moving to another project, and moving an untagged card to the top/bottom without changing its tags. Confirm that Cancel preserves a task in the Delete submenu and Delete removes it. Use `m` or Shift+F10, then ↑/↓, Enter, Escape and the displayed menu-only shortcuts to check keyboard access; `Backspace` must ask for confirmation. Compare the compact menu with List in the same theme. Finish one card via the round check button; verify it disappears and remains available in List. Check the List-marked fallback rows, and reopen the board after switching light/dark themes to check menu colors.
15. On an older Workflow project, confirm its saved `This Week` and `Maybe/Later` lanes now use `This-Week` and `Maybe-Later`, while tasks with only legacy tags appear in Clarify. Drag a task into the new lane and check its old tag is removed, the new tag is added, and unrelated tags survive. Check a second project without opening its board first; its saved lane configuration should also be updated. Try native `#this-week` and `#maybe-later` entry.

## Limits

- The embedded iframe uses its own styled cards, not the app's internal Angular Boards component.
- The card's right-click menu is a plugin-local visual recreation, not the native task-row menu. Actions labelled **List** select the task and switch views; they do not start a focus session, change priority, duplicate, or move to native backlog on their own.
- It does not expose sections, duplicate Boards, or reorder the app's native task list. When no plugin-specific order exists, cards follow the order returned by the plugin task API.
- Both boards hide completed tasks, even when they retain tags from outside the plugin. Moving a card with multiple configured lane tags resolves the conflict by removing the *configured* lane tags; unrelated tags remain.
- Cards can be moved and reordered with Shift+H/J/K/L or by dragging. Subtasks are only accessible through their parent/native details, and these board-local keys do not change the app's native task-list order.
- Timed scheduling uses a second API call after creating the task. If that call fails, the task still exists; the board reports the failure and you can schedule it in native task details.
- Integration with a real running Super Productivity instance still needs the manual checks above. Automated tests cover pure lane rules, a mocked iframe flow, and host preference logic; they are not a substitute for app testing.

The project background and design decisions are in [IDEA.md](IDEA.md) and [PLAN.md](PLAN.md). Licensed under [MIT](LICENSE).
