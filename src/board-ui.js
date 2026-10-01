// Runs only in the embedded iframe. All host interaction uses the supported PluginAPI.
(() => {
  const api = window.PluginAPI;
  const app = document.getElementById("app");
  const state = {
    ctx: null,
    tags: [],
    tasks: [],
    backlog: new Set(),
    config: { lanes: [] },
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
    if (isError) api.log.err("Project Kanban:", message);
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
    let [tags, tasks, projects, rawConfig] = await Promise.all([
      api.getAllTags(),
      api.getTasks(),
      api.getAllProjects(),
      api.loadSyncedData(`lanes-${projectId}`),
    ]);
    if (
      token !== loadToken ||
      (await api.getActiveWorkContext())?.id !== projectId
    ) return;

    let stored = parseConfig(rawConfig);
    if (!stored) {
      // Prefer the tag used by Super Productivity's built-in Kanban; create a
      // regular tag only if it does not exist yet. Persist its ID, never its title.
      let progress = tags.find((tag) => tag.id === "KANBAN_IN_PROGRESS") ||
        tags.find((tag) => tag.title?.toLowerCase() === "in progress");
      if (!progress) {
        const id = await api.addTag({ title: "In Progress" });
        progress = { id, title: "In Progress" };
        tags = [...tags, progress];
      }
      stored = { lanes: [{ tagId: progress.id }] };
      await api.persistDataSynced(JSON.stringify(stored), `lanes-${projectId}`);
    }
    if (
      token !== loadToken ||
      (await api.getActiveWorkContext())?.id !== projectId
    ) return;
    state.ctx = ctx;
    state.tags = tags;
    state.tasks = tasks;
    state.config = BoardCore.normalizeConfig(stored, tags);
    state.backlog = new Set(
      projects.find((project) => project.id === projectId)?.backlogTaskIds ||
        [],
    );
    render();
  }

  async function saveConfig(next) {
    if (!state.ctx) return;
    await api.persistDataSynced(JSON.stringify(next), `lanes-${state.ctx.id}`);
    state.config = BoardCore.normalizeConfig(next, state.tags);
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
    toolbar.append(el("h1", "", `${state.ctx.title} · Kanban`));
    toolbar.append(control("List view", () =>
      void run(async () => {
        await api.persistDataSynced("list", `view-${state.ctx.id}`);
        api.closeWorkContextView();
      })));
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
    const columns = BoardCore.columns(state.config, state.tags);
    const grouped = BoardCore.projectCards(
      state.tasks,
      state.ctx.id,
      state.config,
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
    for (const task of tasks) cards.append(renderCard(task, id, columns));
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
      if (taskId) void move(taskId, id);
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
          ...BoardCore.createFields(projectId, id, state.config),
        });
        input.value = "";
      });
    });
    section.append(form);
    return section;
  }

  function renderCard(task, currentLane, columns) {
    const card = el("article", "card");
    const movable = !task.parentId;
    card.draggable = movable;
    if (movable) {
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", task.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
    }
    const title = control(task.title || "(Untitled task)", () => {
      void api.selectTask(task.id).catch((error) =>
        status(String(error), true)
      );
    }, "card-title");
    title.title = "Open task details";
    card.append(title);
    const info = [];
    if (task.parentId) info.push("Subtask · open in task details to edit");
    if (
      state.backlog.has(task.id) ||
      (task.parentId && state.backlog.has(task.parentId))
    ) info.push("Backlog");
    if (task.subTaskIds?.length) {
      info.push(`${task.subTaskIds.length} subtasks`);
    }
    if (info.length) {
      card.append(el("div", "muted card-meta", info.join(" · ")));
    }
    if (movable) {
      const controls = el("div", "card-controls");
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
      card.append(controls);
    }
    return card;
  }

  function move(taskId, laneId) {
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
      const patch = BoardCore.movePatch(latest, laneId, state.config);
      if (
        JSON.stringify(patch.tagIds) === JSON.stringify(latest.tagIds || []) &&
        patch.isDone === latest.isDone
      ) return;
      await api.updateTask(taskId, patch);
    });
  }

  function renderSettings() {
    const panel = el("section", "settings");
    panel.append(el("h2", "", "Lanes for this project"));
    panel.append(
      el(
        "p",
        "muted",
        "To Do and Done are built in. Tag lanes are project-specific; tags themselves are shared across Super Productivity.",
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
      row.append(control("↑", () => void reorder(index, -1)));
      row.append(control("↓", () => void reorder(index, 1)));
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
