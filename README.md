# Project Kanban plugin

An opt-in Kanban view *inside* Super Productivity projects, scoped to the active project. It is separate from the app's Boards feature and uses tags, not project sections. See [IDEA.md](IDEA.md) and [PLAN.md](PLAN.md).

## Build and install

Requires Super Productivity **18.7.0 or newer** for the project work-view plugin APIs (developed against the published API and a local 19.1.0 installation). Do not test on irreplaceable task data first.

From the workspace root:

```sh
python3 projects/superprod-kanban/code/build.py
deno test --allow-read projects/superprod-kanban/code/tests/
```

Install `projects/superprod-kanban/code/dist/project-kanban.zip` via **Settings → Plugins → Choose Plugin File**. The ZIP contains three files at its root: `manifest.json`, `plugin.js`, and a self-contained `index.html`.

Open any project and click **List / Kanban** in its header. Each project remembers its own view. Use **Configure lanes** to add existing tags, create a tag, change the local display name, reorder lanes, or remove lanes. Removing a lane does not remove its tag or tasks. The first time a board opens, it reuses Super Productivity's built-in In Progress tag if available, otherwise creates a regular In Progress tag. To Do is the fallback for unassigned tasks; Done uses the task's actual completion state. Drag a card to another lane or use its Move to selector; click its title to open the native task details. Subtasks are visible but must be moved from their parent/native task details.

## Verify on a disposable project

1. Make projects A and B. Choose Kanban for A and leave B on List. Switch A → B → A and restart; both should retain their views.
2. Add a task in each lane of A and verify every task belongs to A rather than Inbox/B. Move an existing task with an unrelated tag through each lane and check the tag survives; Done must actually complete it.
3. Create another lane from a tag, rename its **local label**, reorder it, and remove it. Check tasks remain visible in To Do and the global tag name remains unchanged.
4. Check a project with backlog items and subtasks; both are identified, and the native task detail still opens.

## Limits

- The embedded iframe uses its own styled cards, not the app's internal Angular Boards component.
- It does not expose sections, duplicate Boards, or provide native Boards sorting. Current-project cards follow the order returned by the plugin task API.
- The tag-based lane model treats completed tasks as Done even when they retain tags from outside the plugin. Moving a card with multiple configured lane tags resolves the conflict by removing the *configured* lane tags; unrelated tags remain.
- Integration with a real running Super Productivity instance still needs the manual checks above. Automated tests cover pure lane rules and ZIP composition, not host UI behaviour.
