// Runs only in the embedded iframe. All host interaction uses the supported PluginAPI.
(() => {
  const api = window.PluginAPI;
  const app = document.getElementById("app");
  const state = {
    ctx: null,
    tags: [],
    tasks: [],
    backlog: new Set(),
    template: "classic",
    config: { lanes: [] },
    order: {},
    settings: false,
    busy: false,
  };
  let loadToken = 0;
  let refreshTimer;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function status(message, isError = false) {
    const node = document.getElementById("board-status");
    if (node) {
      node.textContent = message;
      node.classList.toggle("error", isError);
    }
    if (isError) console.error("Project Kanban:", message);
  }

  async function run(action) {
    if (state.busy) return;
    state.busy = true;
    try {
      await action();
      await loadProject();
    } catch (error) {
      status(error instanceof Error ? error.message : "Operation failed", true);
    } finally {
      state.busy = false;
    }
  }

  function parseConfig(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        "Lane settings could not be read; no settings were overwritten.",
      );
    }
  }

  async function loadProject() {
    const token = ++loadToken;
    const ctx = await api.getActiveWorkContext();
    if (token !== loadToken) return;
    if (ctx?.type !== "PROJECT") {
      state.ctx = null;
      app.textContent = "Open a project to see its Kanban board.";
      return;
    }
    const projectId = ctx.id;
    const selectedTemplate = await api.loadSyncedData(`template-${projectId}`);
    const template = selectedTemplate === "workflow" ? "workflow" : "classic";
    const configKey = template === "workflow"
      ? `workflow-lanes-${projectId}`
      : `lanes-${projectId}`;
    let [tags, tasks, projects, rawConfig, rawOrder] = await Promise.all([
      api.getAllTags(),
      api.getTasks(),
      api.getAllProjects(),
      api.loadSyncedData(configKey),
      api.loadSyncedData(`order-${template}-${projectId}`),
    ]);
    if (
      token !== loadToken ||
      (await api.getActiveWorkContext())?.id !== projectId
    ) return;

    let stored = parseConfig(rawConfig);
    if (!stored) {
      const names = template === "workflow"
        ? BoardCore.WORKFLOW_TAGS
        : ["In Progress"];
      const lanes = [];
      for (const title of names) {
        // Reuse an existing tag; create only when the template is first selected.
        let tag = title === "In Progress"
          ? tags.find((item) => item.id === "KANBAN_IN_PROGRESS")
          : null;
        tag ||= tags.find((item) =>
          item.title?.toLowerCase() === title.toLowerCase()
        );
        if (!tag) {
          const id = await api.addTag({ title });
          tag = { id, title };
          tags = [...tags, tag];
        }
        lanes.push({ tagId: tag.id });
      }
      stored = { lanes };
      await api.persistDataSynced(JSON.stringify(stored), configKey);
    }
    if (
      token !== loadToken ||
      (await api.getActiveWorkContext())?.id !== projectId
    ) return;
    state.ctx = ctx;
    state.tags = tags;
    state.tasks = tasks;
    state.template = template;
    state.config = BoardCore.normalizeConfig(stored, tags);
    state.order = BoardCore.normalizeOrder(
      parseConfig(rawOrder),
      state.config,
      template,
    );
    state.backlog = new Set(
      projects.find((project) => project.id === projectId)?.backlogTaskIds ||
        [],
    );
    render();
  }

  async function saveConfig(next) {
    if (!state.ctx) return;
    const key = state.template === "workflow"
      ? `workflow-lanes-${state.ctx.id}`
      : `lanes-${state.ctx.id}`;
    await api.persistDataSynced(JSON.stringify(next), key);
    state.config = BoardCore.normalizeConfig(next, state.tags);
  }

  async function saveOrder(next) {
    await api.persistDataSynced(
      JSON.stringify(next),
      `order-${state.template}-${state.ctx.id}`,
    );
    state.order = next;
  }

  function control(label, onClick, className) {
    const button = el("button", className, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function render() {
    if (!state.ctx) return;
    const shell = el("div", "shell");
    const toolbar = el("header", "toolbar");
    toolbar.append(
      control(state.settings ? "Close settings" : "Configure lanes", () => {
        state.settings = !state.settings;
        render();
      }),
    );
    shell.append(toolbar);
    shell.append(el("p", "status", ""));
    shell.lastChild.id = "board-status";
    if (state.settings) shell.append(renderSettings());
    const board = el("div", "board");
    const columns = BoardCore.columns(state.config, state.tags, state.template);
    const grouped = BoardCore.orderCards(
      BoardCore.projectCards(
        state.tasks,
        state.ctx.id,
        state.config,
        state.template,
      ),
      state.order,
    );
    for (const column of columns) {
      board.append(
        renderLane(column, grouped.get(column.tagId || column.kind), columns),
      );
    }
    shell.append(board);
    app.replaceChildren(shell);
  }

  function renderLane(lane, tasks, columns) {
    const id = lane.tagId || lane.kind;
    const section = el("section", "lane");
    section.setAttribute("aria-label", lane.label);
    const header = el("div", "lane-header");
    header.append(
      el("h2", "", lane.label),
      el("span", "count", String(tasks.length)),
    );
    section.append(header);
    const cards = el("div", "cards");
    for (const [index, task] of tasks.entries()) {
      cards.append(renderCard(task, id, columns, tasks[index + 1]?.id || null));
    }
    if (!tasks.length) cards.append(el("p", "muted empty", "No tasks"));
    section.append(cards);
    section.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("text/plain")) {
        event.preventDefault();
        section.classList.add("drop-target");
      }
    });
    section.addEventListener(
      "dragleave",
      () => section.classList.remove("drop-target"),
    );
    section.addEventListener("drop", (event) => {
      event.preventDefault();
      section.classList.remove("drop-target");
      const taskId = event.dataTransfer?.getData("text/plain");
      if (taskId) void move(taskId, id, null);
    });

    const form = el("form", "add-row");
    const input = el("input");
    input.type = "text";
    input.required = true;
    input.maxLength = 500;
    input.placeholder = `Add to ${lane.label}`;
    input.setAttribute("aria-label", `New task in ${lane.label}`);
    const add = el("button", "", "Add");
    add.type = "submit";
    form.append(input, add);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title || !state.ctx) return;
      const projectId = state.ctx.id;
      void run(async () => {
        await api.addTask({
          title,
          ...BoardCore.createFields(
            projectId,
            id,
            state.config,
            state.template,
          ),
        });
        input.value = "";
      });
    });
    section.append(form);
    return section;
  }

  function renderCard(task, currentLane, columns, nextCardId) {
    const card = el("article", "card");
    const movable = !task.parentId;
    card.draggable = movable;
    if (movable) {
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", task.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
    }
    card.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("text/plain")) return;
      event.preventDefault();
      event.stopPropagation();
      const before = event.clientY <
        card.getBoundingClientRect().top + card.offsetHeight / 2;
      card.classList.toggle("drop-before", before);
      card.classList.toggle("drop-after", !before);
    });
    card.addEventListener(
      "dragleave",
      () => card.classList.remove("drop-before", "drop-after"),
    );
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      card.classList.remove("drop-before", "drop-after");
      const taskId = event.dataTransfer?.getData("text/plain");
      if (taskId && taskId !== task.id) {
        const before = event.clientY <
          card.getBoundingClientRect().top + card.offsetHeight / 2;
        void move(taskId, currentLane, before ? task.id : nextCardId);
      }
    });
    const heading = el("div", "card-heading");
    const title = control(task.title || "(Untitled task)", () => {
      void api.selectTask(task.id).catch((error) =>
        status(String(error), true)
      );
    }, "card-title");
    title.title = "Open task details";
    heading.append(title);
    const meta = el("div", "card-meta");
    const scheduled = BoardCore.scheduledDate(task);
    if (scheduled) {
      const label = new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(scheduled.timed ? { hour: "numeric", minute: "2-digit" } : {}),
      }).format(scheduled.date);
      meta.append(el("span", "meta-chip", `◷ Scheduled ${label}`));
    }
    const estimate = BoardCore.estimateLabel(task.timeEstimate);
    if (estimate) meta.append(el("span", "meta-chip", `◴ Est. ${estimate}`));
    if (task.parentId) {
      meta.append(el("span", "meta-chip", "Subtask · open details to edit"));
    }
    if (
      state.backlog.has(task.id) ||
      (task.parentId && state.backlog.has(task.parentId))
    ) meta.append(el("span", "meta-chip", "Backlog"));
    if (task.subTaskIds?.length) {
      meta.append(
        el("span", "meta-chip", `${task.subTaskIds.length} subtasks`),
      );
    }
    if (movable) {
      const controls = el("details", "card-actions");
      const summary = el("summary", "", "⋯");
      summary.setAttribute("aria-label", `Actions for ${task.title}`);
      controls.append(summary);
      const label = el("label", "", "Move to");
      const select = el("select");
      select.setAttribute("aria-label", `Move ${task.title} to lane`);
      for (const lane of columns) {
        const option = el("option", "", lane.label);
        option.value = lane.tagId || lane.kind;
        select.append(option);
      }
      select.value = currentLane;
      select.addEventListener("change", () => void move(task.id, select.value));
      label.append(select);
      controls.append(label);
      if (state.template === "workflow") {
        controls.append(control("Complete", () =>
          void run(async () => {
            const latest = (await api.getTasks()).find((entry) =>
              entry.id === task.id && entry.projectId === state.ctx?.id
            );
            if (!latest) throw new Error("Task changed or left this project.");
            await api.updateTask(
              task.id,
              BoardCore.movePatch(latest, "done", state.config),
            );
          })));
      }
      heading.append(controls);
    }
    card.append(heading);
    if (meta.children.length) card.append(meta);
    return card;
  }

  // beforeId=undefined means a selector change; null means append on drop.
  function move(taskId, laneId, beforeId) {
    const task = state.tasks.find((entry) =>
      entry.id === taskId && entry.projectId === state.ctx?.id
    );
    if (!task || task.parentId) return;
    void run(async () => {
      const latest = (await api.getTasks()).find((entry) =>
        entry.id === taskId && entry.projectId === state.ctx?.id
      );
      if (!latest) {
        throw new Error(
          "Task changed or left this project. Refresh and try again.",
        );
      }
      const patch = BoardCore.movePatch(
        latest,
        laneId,
        state.config,
        state.template,
      );
      const currentLane = BoardCore.laneFor(
        latest,
        state.config,
        state.template,
      );
      const changes =
        JSON.stringify(patch.tagIds) !== JSON.stringify(latest.tagIds || []) ||
        patch.isDone !== latest.isDone;
      if (changes) await api.updateTask(taskId, patch);
      if (currentLane === laneId && beforeId === undefined) return;
      const grouped = BoardCore.orderCards(
        BoardCore.projectCards(
          state.tasks,
          state.ctx.id,
          state.config,
          state.template,
        ),
        state.order,
      );
      await saveOrder(
        BoardCore.placeTask(grouped, state.order, taskId, laneId, beforeId),
      );
    });
  }

  function renderSettings() {
    const panel = el("section", "settings");
    panel.append(el("h2", "", "Board settings"));
    const templateRow = el("label", "template-row", "Template");
    const templatePicker = el("select", "template-picker");
    templatePicker.setAttribute("aria-label", "Kanban template");
    for (
      const [id, label] of [
        ["classic", "Classic · To Do / In Progress / Done"],
        ["workflow", "Workflow · Clarify / Backlog / …"],
      ]
    ) {
      const option = el("option", "", label);
      option.value = id;
      templatePicker.append(option);
    }
    templatePicker.value = state.template;
    templatePicker.addEventListener("change", () =>
      void run(async () => {
        await api.persistDataSynced(
          templatePicker.value,
          `template-${state.ctx.id}`,
        );
      }));
    templateRow.append(templatePicker);
    panel.append(templateRow);
    panel.append(
      el(
        "p",
        "muted",
        state.template === "workflow"
          ? "Clarify holds unfinished tasks without a configured lane tag; completed tasks are hidden. Other lanes use tags."
          : "To Do holds unfinished tasks without a configured lane tag; Done shows completed tasks. Other lanes use tags.",
      ),
    );
    state.config.lanes.forEach((lane, index) => {
      const row = el("div", "settings-row");
      const tag = state.tags.find((item) => item.id === lane.tagId);
      row.append(el("span", "", tag?.title || "Missing tag"));
      const alias = el("input");
      alias.value = lane.label;
      alias.placeholder = "Use tag name";
      alias.maxLength = 80;
      alias.setAttribute(
        "aria-label",
        `Display label for ${tag?.title || "tag"}`,
      );
      alias.addEventListener("change", () =>
        void run(async () => {
          const lanes = state.config.lanes.map((item, i) =>
            i === index ? { ...item, label: alias.value.trim() } : item
          );
          await saveConfig({ lanes });
        }));
      row.append(alias);
      const up = control("↑", () => void reorder(index, -1));
      up.disabled = index === 0;
      up.setAttribute("aria-label", `Move ${tag?.title || "lane"} left`);
      const down = control("↓", () => void reorder(index, 1));
      down.disabled = index === state.config.lanes.length - 1;
      down.setAttribute("aria-label", `Move ${tag?.title || "lane"} right`);
      row.append(up, down);
      row.append(control("Remove", () =>
        void run(async () => {
          await saveConfig({
            lanes: state.config.lanes.filter((_, i) => i !== index),
          });
        })));
      panel.append(row);
    });
    const available = state.tags.filter((tag) =>
      tag.id !== "TODAY" &&
      !state.config.lanes.some((lane) => lane.tagId === tag.id)
    );
    if (available.length) {
      const row = el("div", "settings-row");
      const select = el("select");
      select.setAttribute("aria-label", "Existing tag to add as a lane");
      for (const tag of available) {
        const option = el("option", "", tag.title);
        option.value = tag.id;
        select.append(option);
      }
      row.append(
        select,
        control("Add tag lane", () =>
          void run(async () => {
            await saveConfig({
              lanes: [...state.config.lanes, { tagId: select.value }],
            });
          })),
      );
      panel.append(row);
    }
    const create = el("form", "settings-row");
    const name = el("input");
    name.placeholder = "New tag name";
    name.required = true;
    name.maxLength = 80;
    name.setAttribute("aria-label", "New tag name");
    const add = el("button", "", "Create tag lane");
    add.type = "submit";
    create.append(name, add);
    create.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = name.value.trim();
      if (!title) return;
      void run(async () => {
        const id = await api.addTag({ title });
        state.tags = [...state.tags, { id, title }];
        await saveConfig({ lanes: [...state.config.lanes, { tagId: id }] });
      });
    });
    panel.append(create);
    return panel;
  }

  function reorder(index, direction) {
    const next = index + direction;
    if (next < 0 || next >= state.config.lanes.length) return;
    void run(async () => {
      const lanes = state.config.lanes.slice();
      [lanes[index], lanes[next]] = [lanes[next], lanes[index]];
      await saveConfig({ lanes });
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (state.busy) return;
      void loadProject().catch((error) => status(String(error), true));
    }, 180);
  }

  api.registerHook(api.Hooks.ANY_TASK_UPDATE, scheduleRefresh);
  api.registerHook(api.Hooks.WORK_CONTEXT_CHANGE, scheduleRefresh);
  api.registerHook(api.Hooks.PERSISTED_DATA_CHANGED, scheduleRefresh);
  void loadProject().catch((error) => {
    app.textContent = `Could not load Project Kanban: ${String(error)}`;
  });
})();
