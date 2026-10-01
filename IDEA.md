# Project Kanban for Super Productivity

I want a project-centred Kanban view in [Super Productivity](https://github.com/super-productivity/super-productivity), with a List / Kanban toggle inside each project, similar to Todoist. The main pain point is having to duplicate a board and configure **every column** for each new project. When I add a task from a lane, it must belong to the current project as well as receive the lane assignment; a tag alone is not enough.

The original idea was to use project sections as columns, or automatically create project-specific boards in the existing Boards area. Investigation showed that Boards do not filter by section, and the supported plugin API does not expose section operations or Board creation. Those remain possible future app/API improvements, but they are not the starting point.

## Agreed direction

- Build a plugin that displays a Kanban-style view **within the active project**, rather than duplicating Boards. A project can use its normal list or the Kanban view; switching projects respects each project's saved view preference.
- Render a separate plugin UI that resembles Super Productivity's existing board styling. Reuse its visual conventions and supported theme variables, not unsupported internal Angular components.
- Use configurable **tag-based lanes** for the first version. Start with To Do / In Progress / Done. Each task occupies at most one lane; moving a task changes only its lane tag(s), preserving unrelated tags.
- Treat Done as the task's actual completed state, not merely a tag. Tasks without a configured lane tag must remain visible.
- Keep lane order and configuration flexible per project, without requiring a new board or reapplying project filters to every lane.

See [PLAN.md](PLAN.md) for behaviour, implementation status, feasibility gates, and test criteria; [README.md](README.md) explains building and installing the first plugin version.
