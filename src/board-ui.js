// Runs only in the embedded iframe. All host interaction uses the supported PluginAPI.
(() => {
  const api = window.PluginAPI;
  const app = document.getElementById("app");
  const state = {
    ctx: null,
    tags: [],
    tasks: [],
    projects: [],
    backlog: new Set(),
    template: "simple",
    config: { lanes: [] },
    order: {},
    settings: false,
    busy: false,
    drafts: new Map(),
    focusedCard: null,
    focusBoard: true,
    focusAdd: null,
    help: false,
  };
  let loadToken = 0;
  let refreshTimer;
  let lastG = 0;
  let activeMenu = null;
  let workflowMigration;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // Local line icons keep the menu legible without depending on a host icon font.
  const menuIconPaths = {
    sun:
      "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    sunrise:
      "M3 18h18M5 15a7 7 0 0 1 14 0M12 3v3M5 7l2 2m12-2-2 2M3 15h2m14 0h2",
    archive:
      "M3 8h18v12H3V8Zm5 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3m-6 4 4 3-4 3m4-3H8",
    calendar: "M4 5h16v16H4V5Zm4-2v4m8-4v4M4 9h16m-12 4h8",
    calendarX: "M4 5h16v16H4V5Zm4-2v4m8-4v4M4 9h16m-9 4 5 5m0-5-5 5",
    focus:
      "M3 8V4h4m10 0h4v4M3 16v4h4m10 0h4v-4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    up: "M12 21V3M5 10l7-7 7 7",
    down: "M12 3v18m-7-7 7 7 7-7",
    subtask: "M3 6h17M3 11h14M3 16h10m6-3v8m-4-4h8",
    copy: "M8 3h12v15H8V3ZM4 7H3v14h13v-1",
    estimate: "M6 3h12M6 21h12M8 3v4l4 5-4 5v4m8-18v4l-4 5 4 5v4",
    priority: "M12 3v12m0 4v2",
    tag: "M3 5h12l6 7-6 7H3V5Z",
    arrow: "M3 5h8v2H5v12h14v-5m-9-2h11m-5-5 5 5-5 5",
    folder: "M3 6h7l2 2h9v12H3V6Z",
    trash: "M4 6h16M9 6V4h6v2m-9 0 1 15h10l1-15m-8 5 4 4m0-4-4 4",
    back: "m15 5-7 7 7 7",
    x: "M5 5l14 14M19 5 5 19",
    clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
    dots: "M4 12h.01M12 12h.01M20 12h.01",
    check: "M4 12l5 5L20 6",
    plus: "M12 4v16M4 12h16",
  };
  function menuIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", menuIconPaths[name]);
    svg.append(path);
    return svg;
  }

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

  function ensureWorkflowMigration() {
    if (workflowMigration) return workflowMigration;
    workflowMigration = (async () => {
      const [projects, existingTags] = await Promise.all([
        api.getAllProjects(),
        api.getAllTags(),
      ]);
      const tags = [...existingTags];
      for (const project of projects) {
        const key = `workflow-lanes-${project.id}`;
        const raw = await api.loadSyncedData(key);
        if (!raw) continue;
        let stored;
        try {
          stored = parseConfig(raw);
        } catch {
          // One malformed project must not prevent opening other boards.
          continue;
        }
        if (!Array.isArray(stored?.lanes)) continue;
        for (
          const [title, legacyNames] of Object.entries(
            BoardCore.WORKFLOW_LEGACY_TAGS,
          )
        ) {
          const hasLegacyLane = stored.lanes.some((lane) =>
            tags.some((tag) =>
              tag.id === lane.tagId &&
              legacyNames.some((name) =>
                tag.title?.toLowerCase() === name.toLowerCase()
              )
            )
          );
          if (
            hasLegacyLane &&
            !tags.some((tag) =>
              tag.title?.toLowerCase() === title.toLowerCase()
            )
          ) {
            const id = await api.addTag({ title });
            tags.push({ id, title });
          }
        }
        const migrated = BoardCore.migrateWorkflowConfig(stored, tags);
        if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
          await api.persistDataSynced(JSON.stringify(migrated), key);
        }
      }
    })().catch((error) => {
      workflowMigration = null;
      throw error;
    });
    return workflowMigration;
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
    let migrationError = null;
    try {
      await ensureWorkflowMigration();
    } catch (error) {
      migrationError = error instanceof Error ? error.message : String(error);
    }
    if (token !== loadToken) return;
    const projectId = ctx.id;
    const selectedTemplate = await api.loadSyncedData(`template-${projectId}`);
    // An old Classic preference opens the new simple board without changing tasks.
    const template = selectedTemplate === "workflow" ? "workflow" : "simple";
    const configKey = `workflow-lanes-${projectId}`;
    let [tags, tasks, projects, rawConfig, rawOrder] = await Promise.all([
      api.getAllTags(),
      api.getTasks(),
      api.getAllProjects(),
      template === "workflow" ? api.loadSyncedData(configKey) : null,
      api.loadSyncedData(`order-${template}-${projectId}`),
    ]);
    if (
      token !== loadToken ||
      (await api.getActiveWorkContext())?.id !== projectId
    ) return;

    let stored = template === "workflow" ? parseConfig(rawConfig) : null;
    if (template === "simple" || !stored) {
      const names = template === "workflow"
        ? BoardCore.WORKFLOW_TAGS
        : BoardCore.SIMPLE_TAGS;
      const lanes = [];
      for (const title of names) {
        // Reuse an existing tag; create only when the template is first selected.
        let tag = tags.find((item) =>
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
      if (template === "workflow") {
        await api.persistDataSynced(JSON.stringify(stored), configKey);
      }
    }
    if (
      token !== loadToken ||
      (await api.getActiveWorkContext())?.id !== projectId
    ) return;
    if (state.ctx?.id !== projectId) {
      state.focusedCard = null;
      state.focusBoard = true;
      state.focusAdd = null;
    }
    state.ctx = ctx;
    state.tags = tags;
    state.tasks = tasks;
    state.projects = projects;
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
    if (migrationError) {
      status(
        `Workflow tag update failed; existing lanes were kept. ${migrationError}`,
        true,
      );
    }
  }

  async function saveConfig(next) {
    if (!state.ctx || state.template !== "workflow") return;
    const key = `workflow-lanes-${state.ctx.id}`;
    const stored = state.config.retiredTagIds?.length
      ? { ...next, retiredTagIds: state.config.retiredTagIds }
      : next;
    await api.persistDataSynced(JSON.stringify(stored), key);
    state.config = BoardCore.normalizeConfig(stored, state.tags);
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
    closeMenu();
    const restoreCard = document.activeElement?.classList.contains("card")
      ? state.focusedCard
      : null;
    const restoreBoard = state.focusBoard ||
      document.activeElement?.classList.contains("board");
    const restoreEdit =
      document.activeElement?.classList.contains("card-title-input")
        ? {
          taskId: document.activeElement.dataset.taskId,
          value: document.activeElement.value,
          caret: document.activeElement.selectionStart,
        }
        : null;
    const restoreInputLane =
      document.activeElement?.classList.contains("task-add-input")
        ? document.activeElement.dataset.laneId
        : null;
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
    if (state.help && !state.settings) {
      shell.append(
        el(
          "p",
          "keyboard-help",
          "Esc: board focus · j: focus first card · j/k: next/previous · h/l: lane · Shift+H/J/K/L: move · gg/G: first/last · e: edit · m: actions · Enter: details · a/i: add · d: finish · ?: help · Shift+V: List",
        ),
      );
    }
    const board = el("div", "board");
    board.tabIndex = 0;
    board.setAttribute(
      "aria-label",
      "Kanban board. Press j to focus a card, or ? for shortcuts.",
    );
    board.addEventListener("focus", () => {
      state.focusedCard = null;
    });
    board.addEventListener("click", (event) => {
      if (!event.target.closest?.(".card, .add-row, button, input, select")) {
        board.focus();
      }
    });
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
        renderLane(column, grouped.get(column.tagId || column.kind)),
      );
    }
    shell.append(board);
    app.replaceChildren(shell);
    state.focusBoard = false;
    if (
      state.focusAdd && (state.focusAdd.projectId !== state.ctx.id ||
        state.focusAdd.template !== state.template)
    ) state.focusAdd = null;
    if (
      state.focusAdd?.projectId === state.ctx.id &&
      state.focusAdd?.template === state.template
    ) {
      const lane = Array.from(document.querySelectorAll(".lane")).find((node) =>
        node.dataset.laneId === state.focusAdd.laneId
      );
      state.focusAdd = null;
      lane?.querySelector(".add-row input")?.focus();
    } else if (restoreEdit) {
      const card = Array.from(document.querySelectorAll(".card")).find((node) =>
        node.dataset.taskId === restoreEdit.taskId
      );
      if (card) {
        card.startEditing();
        const input = card.querySelector(".card-title-input");
        input.value = restoreEdit.value;
        input.setSelectionRange(restoreEdit.caret, restoreEdit.caret);
      } else board.focus();
    } else if (restoreCard) {
      const card = Array.from(document.querySelectorAll(".card")).find((node) =>
        node.dataset.taskId === restoreCard.taskId
      );
      const lane = Array.from(document.querySelectorAll(".lane")).find((node) =>
        node.dataset.laneId === restoreCard.laneId
      );
      (card || lane?.querySelector(".card") ||
        document.querySelector(".card") ||
        board)?.focus();
    } else if (restoreInputLane) {
      const lane = Array.from(document.querySelectorAll(".lane")).find((node) =>
        node.dataset.laneId === restoreInputLane
      );
      lane?.querySelector(".add-row input")?.focus();
    } else if (restoreBoard) {
      board.focus();
    }
  }

  function renderLane(lane, tasks) {
    const id = lane.tagId || lane.kind;
    const section = el("section", "lane");
    section.dataset.laneId = id;
    section.setAttribute("aria-label", lane.label);
    const header = el("div", "lane-header");
    header.append(
      el("h2", "", lane.label),
      el("span", "count", String(tasks.length)),
    );
    section.append(header);
    const cards = el("div", "cards");
    for (const [index, task] of tasks.entries()) {
      cards.append(renderCard(task, id, tasks[index + 1]?.id || null));
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

    section.append(renderAddForm(lane, id));
    return section;
  }

  function setupSuggestions(
    input,
    container,
    laneId,
    onChange = () => {},
    id = `suggestions-${laneId}`,
  ) {
    const suggestions = el("div", "input-suggestions");
    suggestions.id = id;
    suggestions.setAttribute("role", "listbox");
    suggestions.hidden = true;
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", suggestions.id);
    input.setAttribute("aria-expanded", "false");
    container.append(suggestions);

    let activeToken = null;
    let candidates = [];
    let selectedIndex = 0;
    function hideSuggestions() {
      suggestions.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      activeToken = null;
    }
    function chooseSuggestion(candidate) {
      if (!activeToken) return;
      const { start, end, kind } = activeToken;
      const syntax = kind === "tag"
        ? `#${/\s/.test(candidate) ? `"${candidate}"` : candidate}`
        : kind === "date"
        ? `@${candidate}`
        : candidate;
      input.value = input.value.slice(0, start) + syntax +
        input.value.slice(end);
      onChange();
      hideSuggestions();
      input.focus();
      input.setSelectionRange(start + syntax.length, start + syntax.length);
    }
    function updateSuggestions() {
      const caret = input.selectionStart ?? input.value.length;
      const prefix = input.value.slice(0, caret);
      const trigger = /(^|\s)([#@])([^#@]*)$/.exec(prefix);
      let kind, query, start;
      if (
        trigger &&
        (trigger[2] === "@" || !/\s/.test(trigger[3].replace(/^"/, "")))
      ) {
        kind = trigger[2] === "@" ? "date" : "tag";
        query = trigger[3].replace(/^"/, "");
        start = caret - trigger[3].length - 1;
      }
      if (kind === "date") {
        // Once a complete @ date is followed by space, the next token can be
        // a title word or an estimate; don't keep showing date suggestions.
        for (const match of query.matchAll(/\s+/g)) {
          const date = query.slice(0, match.index).toLowerCase();
          if (BoardCore.dateSuggestions(date).includes(date)) {
            kind = null;
            break;
          }
        }
      }
      if (!kind) {
        const duration = /(^|\s)(\d+(?:[.,]\d+)?\s*[hm](?:\s*\d*\s*m)?)$/i.exec(
          prefix,
        );
        if (duration) {
          kind = "estimate";
          query = duration[2];
          start = caret - duration[2].length;
        }
      }
      if (!kind) {
        hideSuggestions();
        return;
      }
      activeToken = { start, end: caret, kind };
      if (kind === "date") candidates = BoardCore.dateSuggestions(query);
      else if (kind === "estimate") {
        candidates = BoardCore.estimateSuggestions(query);
      } else {
        const laneTagIds = new Set(
          state.config.lanes.map((item) => item.tagId),
        );
        candidates = state.tags.filter((tag) =>
          tag.id !== "TODAY" && !laneTagIds.has(tag.id) &&
          !state.config.retiredTagIds?.includes(tag.id) &&
          tag.title?.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 10).map((tag) => tag.title);
      }
      if (!candidates.length && kind === "estimate") {
        hideSuggestions();
        return;
      }
      selectedIndex = 0;
      suggestions.replaceChildren();
      for (const [index, candidate] of candidates.entries()) {
        const option = control(
          candidate,
          () => chooseSuggestion(candidate),
          "suggestion-option",
        );
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === selectedIndex));
        option.id = `${suggestions.id}-${index}`;
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", (event) => event.stopPropagation());
        suggestions.append(option);
      }
      if (candidates.length) {
        input.setAttribute("aria-activedescendant", suggestions.children[0].id);
      } else input.removeAttribute("aria-activedescendant");
      if (!candidates.length) {
        suggestions.append(
          el(
            "span",
            "muted",
            kind === "date"
              ? "Try @today, @tomorrow or @YYYY-MM-DD."
              : "No matching tags. Lane tags come from the column.",
          ),
        );
      }
      suggestions.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
    function navigateSuggestions(event) {
      if (suggestions.hidden) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        hideSuggestions();
        return true;
      }
      if (!candidates.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        selectedIndex = (selectedIndex + (event.key === "ArrowDown" ? 1 : -1) +
          candidates.length) % candidates.length;
        Array.from(suggestions.children).forEach((node, i) =>
          node.setAttribute("aria-selected", String(i === selectedIndex))
        );
        input.setAttribute(
          "aria-activedescendant",
          suggestions.children[selectedIndex].id,
        );
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        chooseSuggestion(candidates[selectedIndex]);
        return true;
      }
      return false;
    }
    input.addEventListener("input", () => {
      onChange();
      updateSuggestions();
    });
    input.addEventListener("keyup", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        updateSuggestions();
      }
    });
    input.addEventListener("click", updateSuggestions);

    return {
      onKeydown: (event) => activeToken && navigateSuggestions(event),
      hide: hideSuggestions,
    };
  }

  function renderAddForm(lane, laneId) {
    const key = `${state.ctx.id}:${state.template}:${laneId}`;
    const form = el("form", "add-row");
    const main = el("div", "add-main");
    const input = el("input");
    input.className = "task-add-input";
    input.dataset.laneId = laneId;
    input.type = "text";
    input.required = true;
    input.maxLength = 500;
    input.value = state.drafts.get(key) || "";
    input.placeholder = `Add to ${lane.label}`;
    input.setAttribute("aria-label", `New task in ${lane.label}`);
    const add = el("button", "", "Add");
    add.type = "submit";
    main.append(input, add);
    form.append(main);

    const autocomplete = setupSuggestions(
      input,
      form,
      laneId,
      () => state.drafts.set(key, input.value),
    );
    input.addEventListener("keydown", (event) => {
      if (autocomplete.onKeydown(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const lane = Array.from(document.querySelectorAll(".lane")).find((
          node,
        ) => node.dataset.laneId === laneId);
        const cards = Array.from(lane?.querySelectorAll(".card") || []);
        (cards.find((node) =>
          node.dataset.taskId === state.focusedCard?.taskId
        ) || cards[0] || document.querySelector(".board"))?.focus();
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.ctx) return;
      const projectId = state.ctx.id;
      let parsed;
      try {
        parsed = BoardCore.parseQuickAdd(
          input.value,
          state.tags,
          state.config,
          laneId,
        );
      } catch (error) {
        status(error.message, true);
        return;
      }
      void run(async () => {
        const fields = BoardCore.createFields(
          projectId,
          laneId,
          state.config,
          state.template,
        );
        const taskId = await api.addTask({
          title: parsed.title,
          ...fields,
          tagIds: [...fields.tagIds, ...parsed.tagIds],
          ...(parsed.schedule.dueDay ? { dueDay: parsed.schedule.dueDay } : {}),
          ...(parsed.timeEstimate ? { timeEstimate: parsed.timeEstimate } : {}),
        });
        if (parsed.schedule.dueWithTime) {
          try {
            // PluginCreateTaskData supports all-day dates; timed dates require an update.
            await api.updateTask(taskId, {
              dueWithTime: parsed.schedule.dueWithTime,
              dueDay: null,
            });
          } catch {
            state.drafts.delete(key);
            await loadProject();
            throw new Error(
              "Task created, but its scheduled time could not be saved. Edit it in task details.",
            );
          }
        }
        state.drafts.delete(key);
        state.focusAdd = { projectId, template: state.template, laneId };
      });
    });
    return form;
  }

  function closeMenu(restoreFocus = true) {
    if (!activeMenu) return;
    const { node, card } = activeMenu;
    activeMenu = null;
    node.remove();
    if (restoreFocus && card.isConnected) card.focus();
  }

  function finishTask(taskId) {
    const projectId = state.ctx?.id;
    void run(async () => {
      const latest = (await api.getTasks()).find((entry) =>
        entry.id === taskId && entry.projectId === projectId && !entry.parentId
      );
      if (!latest) throw new Error("Task changed or left this project.");
      await api.updateTask(latest.id, { isDone: true });
    });
  }

  function scheduleTask(taskId, day) {
    const projectId = state.ctx?.id;
    void run(async () => {
      const latest = (await api.getTasks()).find((entry) =>
        entry.id === taskId && entry.projectId === projectId && !entry.parentId
      );
      if (!latest) throw new Error("Task changed or left this project.");
      await api.updateTask(latest.id, {
        dueDay: BoardCore.resolveDateSuggestion(day).day,
        dueWithTime: null,
      });
    });
  }

  function orderTask(taskId, laneId, toTop) {
    void run(async () => {
      const grouped = BoardCore.orderCards(
        BoardCore.projectCards(
          state.tasks,
          state.ctx.id,
          state.config,
          state.template,
        ),
        state.order,
      );
      if (!grouped.get(laneId)?.some((task) => task.id === taskId)) {
        throw new Error("Task changed or left this lane.");
      }
      const beforeId = toTop
        ? grouped.get(laneId).find((task) => task.id !== taskId)?.id || null
        : null;
      await saveOrder(
        BoardCore.placeTask(grouped, state.order, taskId, laneId, beforeId),
      );
    });
  }

  function updateCardTask(taskId, changes) {
    const projectId = state.ctx?.id;
    void run(async () => {
      const latest = (await api.getTasks()).find((entry) =>
        entry.id === taskId && entry.projectId === projectId && !entry.parentId
      );
      if (!latest) throw new Error("Task changed or left this project.");
      await api.updateTask(taskId, changes(latest));
    });
  }

  function openTaskInList(taskId) {
    const projectId = state.ctx?.id;
    if (!projectId) return;
    void api.selectTask(taskId)
      .then(() => api.persistDataSynced("list", `view-${projectId}`))
      .then(() => api.closeWorkContextView())
      .catch((error) => status(String(error), true));
  }

  function addSubtask(taskId, title) {
    const projectId = state.ctx?.id;
    void run(async () => {
      const latest = (await api.getTasks()).find((entry) =>
        entry.id === taskId && entry.projectId === projectId && !entry.parentId
      );
      if (!latest) throw new Error("Task changed or left this project.");
      const subtaskId = await api.addTask({
        title,
        parentId: taskId,
        projectId,
      });
      await api.selectTask(subtaskId);
    });
  }

  function deleteCardTask(taskId) {
    const projectId = state.ctx?.id;
    void run(async () => {
      const latest = (await api.getTasks()).find((entry) =>
        entry.id === taskId && entry.projectId === projectId && !entry.parentId
      );
      if (!latest) throw new Error("Task changed or left this project.");
      await api.deleteTask(taskId);
    });
  }

  function openCardMenu(card, task, laneId, x, y) {
    closeMenu(false);
    card.focus();
    const menu = el("div", "card-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute(
      "aria-label",
      `Actions for ${task.title || "Untitled task"}`,
    );
    menu.tabIndex = -1;
    const positionMenu = () => {
      const width = menu.offsetWidth || 255;
      const height = menu.offsetHeight || 530;
      const left = Number.isFinite(x) ? x : 8;
      const top = Number.isFinite(y) ? y : 8;
      menu.style.left = `${
        Math.max(8, Math.min(left, (window.innerWidth || 1024) - width - 8))
      }px`;
      menu.style.top = `${
        Math.max(8, Math.min(top, (window.innerHeight || 768) - height - 8))
      }px`;
    };
    let view = "main";
    const item = (
      container,
      icon,
      label,
      callback,
      hint = "",
      submenu = false,
    ) => {
      const button = control("", (event) => {
        event.stopPropagation();
        if (!submenu) closeMenu();
        callback();
      }, "card-menu-item");
      button.setAttribute("role", "menuitem");
      if (submenu) button.setAttribute("aria-haspopup", "true");
      const symbol = el("span", "card-menu-icon");
      symbol.setAttribute("aria-hidden", "true");
      symbol.append(menuIcon(icon));
      button.append(symbol, el("span", "card-menu-label", label));
      if (hint) button.append(el("span", "card-menu-hint", hint));
      if (submenu) button.append(el("span", "card-menu-chevron", "›"));
      container.append(button);
      return button;
    };
    const show = (title, build) => {
      menu.focus();
      menu.replaceChildren();
      view = title || "main";
      if (title) {
        item(menu, "back", title, showMain, "", true).classList.add(
          "card-menu-back",
        );
      }
      build();
      positionMenu();
      menu.querySelector("button, input")?.focus();
    };
    const options = (title, entries) =>
      show(title, () => {
        const list = el("div", "card-menu-actions");
        for (const [icon, label, callback, hint, submenu] of entries) {
          item(list, icon, label, callback, hint, submenu);
        }
        menu.append(list);
      });
    const formView = (title, label, type, initial, onSubmit) =>
      show(title, () => {
        const form = el("form", "card-menu-form");
        const input = el("input");
        input.type = type;
        input.value = initial;
        input.required = true;
        input.setAttribute("aria-label", label);
        const save = control("Save", () => {}, "card-menu-save");
        save.type = "submit";
        form.append(input, save);
        const errorMessage = el("p", "card-menu-form-error");
        errorMessage.setAttribute("role", "alert");
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const value = input.value.trim();
          if (!value) return;
          try {
            onSubmit(value);
          } catch (error) {
            errorMessage.textContent = error.message;
            input.focus();
            return;
          }
          closeMenu();
        });
        menu.append(form, errorMessage);
        input.focus();
      });
    const showMain = () =>
      show(null, () => {
        const toolbar = el("div", "card-menu-toolbar");
        const tool = (icon, label, callback) => {
          const button = control("", (event) => {
            event.stopPropagation();
            callback();
          });
          button.setAttribute("role", "menuitem");
          button.setAttribute("aria-label", label);
          button.title = label;
          button.append(menuIcon(icon));
          toolbar.append(button);
        };
        tool("sun", "Schedule today", () => {
          closeMenu();
          scheduleTask(task.id, "today");
        });
        tool("sunrise", "Schedule tomorrow", () => {
          closeMenu();
          scheduleTask(task.id, "tomorrow");
        });
        tool("archive", "Move to backlog in List", () => {
          closeMenu();
          openTaskInList(task.id);
        });
        tool("calendar", "Choose scheduled date", () =>
          formView(
            "Choose scheduled date",
            "Scheduled date",
            "date",
            task.dueDay || "",
            (value) => {
              const schedule = BoardCore.parseSchedule(value, "");
              updateCardTask(
                task.id,
                () => ({ ...schedule, dueWithTime: null }),
              );
            },
          ));
        tool("calendarX", "Remove scheduled date", () => {
          closeMenu();
          updateCardTask(task.id, () => ({ dueDay: null, dueWithTime: null }));
        });
        menu.append(toolbar);
        const list = el("div", "card-menu-actions");
        item(
          list,
          "focus",
          "Start focus session",
          () => openTaskInList(task.id),
          "List",
        );
        item(list, "up", "Move to top", () => orderTask(task.id, laneId, true));
        item(
          list,
          "down",
          "Move to bottom",
          () => orderTask(task.id, laneId, false),
        );
        item(
          list,
          "subtask",
          "Add subtask",
          () =>
            formView(
              "Add subtask",
              "Subtask title",
              "text",
              "",
              (title) => addSubtask(task.id, title),
            ),
          "A",
          true,
        ).classList.add("card-menu-shortcut-only");
        item(list, "copy", "Duplicate", () => openTaskInList(task.id), "List");
        item(
          list,
          "estimate",
          "Estimate",
          () =>
            options("Estimate", [
              [
                "x",
                "Clear estimate",
                () => updateCardTask(task.id, () => ({ timeEstimate: 0 })),
              ],
              ...["15m", "30m", "1h", "2h"].map((label) => [
                "clock",
                label,
                () =>
                  updateCardTask(task.id, () => ({
                    timeEstimate: BoardCore.parseEstimate(label),
                  })),
              ]),
              [
                "dots",
                "Custom estimate",
                () =>
                  formView(
                    "Custom estimate",
                    "Time estimate (e.g. 45m or 1h 30m)",
                    "text",
                    "",
                    (value) => {
                      const timeEstimate = BoardCore.parseEstimate(value);
                      updateCardTask(task.id, () => ({ timeEstimate }));
                    },
                  ),
                "",
                true,
              ],
            ]),
          "T",
          true,
        );
        item(
          list,
          "priority",
          "Priority",
          () => openTaskInList(task.id),
          "List",
        );
        item(
          list,
          "tag",
          "Toggle tags",
          () => {
            const laneTags = new Set(
              state.config.lanes.map((lane) => lane.tagId),
            );
            options(
              "Toggle tags",
              state.tags
                .filter((tag) => tag.id !== "TODAY" && !laneTags.has(tag.id))
                .filter((tag) => !state.config.retiredTagIds?.includes(tag.id))
                .map((tag) => [
                  task.tagIds?.includes(tag.id) ? "check" : "plus",
                  tag.title,
                  () =>
                    updateCardTask(task.id, (latest) => ({
                      tagIds: latest.tagIds?.includes(tag.id)
                        ? latest.tagIds.filter((id) => id !== tag.id)
                        : [...new Set([...(latest.tagIds || []), tag.id])],
                    })),
                ]),
            );
          },
          "G",
          true,
        );
        item(
          list,
          "arrow",
          "Move to project",
          () =>
            options(
              "Move to project",
              state.projects.filter((project) =>
                project.id !== state.ctx?.id && !project.isArchived
              ).map((project) => [
                "folder",
                project.title,
                () => {
                  if (task.repeatCfgId) openTaskInList(task.id);
                  else {
                    updateCardTask(
                      task.id,
                      () => ({ projectId: project.id }),
                    );
                  }
                },
                task.repeatCfgId ? "List: repeats" : "",
              ]),
            ),
          "E",
          true,
        );
        const deleteItem = item(
          list,
          "trash",
          "Delete task",
          () =>
            show(
              "Delete task",
              () => {
                menu.append(
                  el(
                    "p",
                    "card-menu-warning",
                    "Delete this task and its subtasks? This cannot be undone.",
                  ),
                );
                const actions = el("div", "card-menu-actions");
                item(actions, "x", "Cancel", showMain, "", true);
                item(
                  actions,
                  "trash",
                  "Delete task and subtasks",
                  () => deleteCardTask(task.id),
                );
                menu.append(actions);
              },
            ),
          "Backspace",
          true,
        );
        deleteItem.classList.add("card-menu-danger");
        menu.append(list);
      });
    menu.addEventListener("keydown", (event) => {
      const items = Array.from(menu.querySelectorAll("button"));
      const index = items.indexOf(document.activeElement);
      const shortcut = view === "main" && !event.ctrlKey && !event.altKey &&
          !event.metaKey && !event.shiftKey &&
          document.activeElement?.tagName !== "INPUT"
        ? {
          a: "Add subtask",
          t: "Estimate",
          g: "Toggle tags",
          e: "Move to project",
          Backspace: "Delete task",
        }[event.key]
        : null;
      if (event.key === "Escape") {
        event.preventDefault();
        if (view === "main") closeMenu();
        else showMain();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (document.activeElement?.tagName === "INPUT") return;
        event.preventDefault();
        items[
          (index + items.length + (event.key === "ArrowDown" ? 1 : -1)) %
          items.length
        ].focus();
      } else if (event.key === "ArrowLeft" && view !== "main") {
        event.preventDefault();
        showMain();
      } else if (
        event.key === "ArrowRight" &&
        document.activeElement?.getAttribute?.("aria-haspopup") === "true"
      ) {
        event.preventDefault();
        document.activeElement.click();
      } else if (shortcut) {
        event.preventDefault();
        Array.from(menu.querySelectorAll(".card-menu-item")).find((button) =>
          button.querySelector(".card-menu-label")?.textContent === shortcut
        )?.click();
      }
    });
    menu.addEventListener("focusout", (event) => {
      if (!menu.contains(event.relatedTarget)) closeMenu(false);
    });
    document.querySelector(".shell").append(menu);
    activeMenu = { node: menu, card };
    showMain();
  }

  document.addEventListener("pointerdown", (event) => {
    if (activeMenu && !activeMenu.node.contains(event.target)) closeMenu(false);
  });

  function renderCard(task, currentLane, nextCardId) {
    const card = el("article", "card");
    card.dataset.taskId = task.id;
    card.addEventListener("focus", () => {
      state.focusedCard = { laneId: currentLane, taskId: task.id };
    });
    card.setAttribute("role", "group");
    card.tabIndex = 0;
    card.setAttribute("aria-keyshortcuts", "M Shift+F10");
    card.setAttribute(
      "aria-label",
      `${
        task.title || "Untitled task"
      }. Enter for details, m for actions, d to complete`,
    );
    const openDetails = () => {
      void api.selectTask(task.id).catch((error) =>
        status(String(error), true)
      );
    };
    card.addEventListener("click", openDetails);
    card.addEventListener("contextmenu", (event) => {
      if (
        event.target?.closest?.("input, textarea, select, [contenteditable]")
      ) return;
      event.preventDefault();
      openCardMenu(card, task, currentLane, event.clientX, event.clientY);
    });
    card.addEventListener("keydown", (event) => {
      if (event.target && event.target !== card) return;
      if (event.key === "m" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        const rect = card.getBoundingClientRect();
        openCardMenu(
          card,
          task,
          currentLane,
          rect.left || 8,
          rect.bottom || rect.top || 8,
        );
        return;
      }
      if (event.key === "e") {
        event.preventDefault();
        startEditing();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetails();
      }
    });
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
    const title = el("span", "card-title", task.title || "(Untitled task)");
    const titleInput = el("input", "card-title-input");
    titleInput.dataset.taskId = task.id;
    titleInput.type = "text";
    titleInput.maxLength = 500;
    titleInput.hidden = true;
    titleInput.setAttribute(
      "aria-label",
      `Edit title for ${task.title || "Untitled task"}`,
    );
    let editing = false;
    function stopEditing(restoreFocus = true) {
      if (!editing) return;
      editing = false;
      autocomplete.hide();
      title.hidden = false;
      titleInput.hidden = true;
      card.draggable = !task.parentId;
      if (restoreFocus) card.focus();
    }
    function startEditing() {
      if (editing) return;
      editing = true;
      titleInput.value = task.title || "";
      title.hidden = true;
      titleInput.hidden = false;
      card.draggable = false;
      titleInput.focus();
      titleInput.setSelectionRange(
        titleInput.value.length,
        titleInput.value.length,
      );
    }
    card.startEditing = startEditing;
    titleInput.addEventListener("click", (event) => event.stopPropagation());
    titleInput.addEventListener("blur", () => stopEditing(false));
    titleInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      if (autocomplete.onKeydown(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stopEditing();
        return;
      }
      const rawTitle = titleInput.value;
      if (rawTitle.trim() === task.title) {
        stopEditing();
        return;
      }
      let parsed;
      try {
        parsed = BoardCore.parseQuickAdd(
          rawTitle,
          state.tags,
          state.config,
          currentLane,
        );
      } catch (error) {
        status(error.message, true);
        return;
      }
      stopEditing();
      void run(async () => {
        try {
          const latest = (await api.getTasks()).find((entry) =>
            entry.id === task.id && entry.projectId === state.ctx?.id
          );
          if (!latest) throw new Error("Task changed or left this project.");
          const patch = { title: parsed.title };
          if (parsed.tagIds.length) {
            patch.tagIds = [
              ...new Set([...(latest.tagIds || []), ...parsed.tagIds]),
            ];
          }
          if (parsed.schedule.dueDay) {
            patch.dueDay = parsed.schedule.dueDay;
            patch.dueWithTime = null;
          } else if (parsed.schedule.dueWithTime) {
            patch.dueWithTime = parsed.schedule.dueWithTime;
            patch.dueDay = null;
          }
          if (parsed.timeEstimate) patch.timeEstimate = parsed.timeEstimate;
          await api.updateTask(latest.id, patch);
        } catch (error) {
          if (state.ctx?.id === task.projectId && card.isConnected) {
            startEditing();
            titleInput.value = rawTitle;
          }
          throw error;
        }
      });
    });
    const complete = control("", (event) => {
      event.stopPropagation();
      card.focus();
      finishTask(task.id);
    }, "card-complete");
    complete.setAttribute(
      "aria-label",
      `Complete ${task.title || "Untitled task"}`,
    );
    complete.title = "Complete task";
    heading.append(complete, title, titleInput);
    const autocomplete = setupSuggestions(
      titleInput,
      heading,
      currentLane,
      undefined,
      `edit-suggestions-${task.id}`,
    );
    const meta = el("div", "card-meta");
    const scheduled = BoardCore.scheduledDate(task);
    if (state.backlog.has(task.id)) {
      meta.append(el("span", "meta-chip", "Backlog"));
    }
    if (task.subTaskIds?.length) {
      meta.append(
        el("span", "meta-chip", `${task.subTaskIds.length} subtasks`),
      );
    }
    const estimate = BoardCore.estimateLabel(task.timeEstimate);
    if (estimate) {
      const time = el("span", "card-estimate", estimate);
      time.title = `Estimated time: ${estimate}`;
      heading.append(time);
    }
    if (scheduled) {
      const full = new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        ...(scheduled.timed ? { timeStyle: "short" } : {}),
      }).format(scheduled.date);
      const today = new Date();
      const isToday = scheduled.timed &&
        scheduled.date.toDateString() === today.toDateString();
      const short = new Intl.DateTimeFormat(
        undefined,
        isToday
          ? { hour: "numeric", minute: "2-digit" }
          : { month: "numeric", day: "numeric" },
      ).format(scheduled.date);
      const badge = el(
        "span",
        scheduled.timed ? "schedule-indicator timed" : "schedule-indicator",
      );
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", `Scheduled for ${full}`);
      badge.title = `Scheduled for ${full}`;
      const icon = el("span", "schedule-icon");
      icon.setAttribute("aria-hidden", "true");
      const date = el("span", "schedule-date", short);
      date.setAttribute("aria-hidden", "true");
      badge.append(icon, date);
      heading.append(badge);
    }
    card.append(heading);
    if (meta.children.length) card.append(meta);
    return card;
  }

  // null means append on drop; a task ID inserts before that card.
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
      const changes =
        JSON.stringify(patch.tagIds) !== JSON.stringify(latest.tagIds || []) ||
        patch.isDone !== latest.isDone;
      if (changes) await api.updateTask(taskId, patch);
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
        ["simple", "Simple · Backlog / Doing"],
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
          : "Backlog also shows untagged tasks. Backlog and Doing reuse Workflow tags; completed tasks and subtask cards are hidden.",
      ),
    );
    if (state.template === "simple") return panel;
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
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const inField = event.target?.closest?.(
      "input, textarea, select, [contenteditable]",
    );
    const controlAltK = event.ctrlKey && event.altKey && !event.shiftKey &&
      !event.metaKey && key === "k" && !event.getModifierState?.("AltGraph");
    const shiftV = event.shiftKey && !event.ctrlKey && !event.altKey &&
      !event.metaKey && key === "v" && !inField;
    if (
      !state.ctx || event.repeat || !(controlAltK || shiftV)
    ) return;
    event.preventDefault();
    void api.persistDataSynced("list", `view-${state.ctx.id}`)
      .then(() => api.closeWorkContextView())
      .catch((error) => status(String(error), true));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "g") lastG = 0;
    const cardFocused = document.activeElement?.classList.contains("card");
    const boardFocused = document.activeElement?.classList.contains("board");
    if (
      !state.ctx || event.ctrlKey || event.altKey || event.metaKey ||
      event.target?.closest?.(
        "input, textarea, select, button, [contenteditable]",
      ) ||
      state.settings || (!cardFocused && !boardFocused)
    ) return;
    if (event.key === "Escape" && state.help) {
      event.preventDefault();
      state.help = false;
      render();
      return;
    }
    if (event.key === "Escape" && cardFocused) {
      event.preventDefault();
      document.querySelector(".board")?.focus();
      return;
    }
    const lanes = Array.from(document.querySelectorAll(".lane"));
    if (!lanes.length) return;
    const current = cardFocused ? state.focusedCard : null;
    const laneIndex = Math.max(
      0,
      lanes.findIndex((lane) => lane.dataset.laneId === current?.laneId),
    );
    const cards = (lane) => Array.from(lane.querySelectorAll(".card"));
    const inLane = cards(lanes[laneIndex]);
    const cardIndex = inLane.findIndex((card) =>
      card.dataset.taskId === current?.taskId
    );
    const focus = (card) => {
      card?.focus();
      card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    if (boardFocused && ["j", "k", "g", "G"].includes(event.key)) {
      event.preventDefault();
      const available = Array.from(document.querySelectorAll(".card"));
      focus(event.key === "G" ? available.at(-1) : available[0]);
      return;
    }
    if (
      event.shiftKey && ["H", "J", "K", "L"].includes(event.key) &&
      current?.taskId && document.activeElement?.classList.contains("card")
    ) {
      const task = state.tasks.find((entry) => entry.id === current.taskId);
      if (task?.parentId) {
        status("Move subtasks in native task details.", true);
        return;
      }
      let destination, beforeId;
      if (event.key === "H" || event.key === "L") {
        const index = laneIndex + (event.key === "H" ? -1 : 1);
        if (index >= 0 && index < lanes.length) {
          destination = lanes[index].dataset.laneId;
          beforeId = null;
        }
      } else if (event.key === "K" && cardIndex > 0) {
        destination = current.laneId;
        beforeId = inLane[cardIndex - 1].dataset.taskId;
      } else if (
        event.key === "J" && cardIndex >= 0 &&
        cardIndex < inLane.length - 1
      ) {
        destination = current.laneId;
        beforeId = inLane[cardIndex + 2]?.dataset.taskId || null;
      }
      if (destination) {
        event.preventDefault();
        move(current.taskId, destination, beforeId);
      }
      return;
    }
    let target;
    if (event.key === "j" || event.key === "k") {
      target = inLane[
        Math.max(
          0,
          Math.min(
            inLane.length - 1,
            cardIndex + (event.key === "j" ? 1 : -1),
          ),
        )
      ];
    } else if (event.key === "h" || event.key === "l") {
      const step = event.key === "h" ? -1 : 1;
      for (let i = laneIndex + step; i >= 0 && i < lanes.length; i += step) {
        const neighboring = cards(lanes[i]);
        if (neighboring.length) {
          target = neighboring[
            Math.max(0, Math.min(cardIndex, neighboring.length - 1))
          ];
          break;
        }
      }
    } else if (event.key === "g") {
      if (Date.now() - lastG < 700) target = inLane[0];
      lastG = Date.now();
    } else if (event.key === "G") {
      target = inLane.at(-1);
    } else if (event.key === "a" || event.key === "i") {
      event.preventDefault();
      lanes[laneIndex]?.querySelector(".add-row input")?.focus();
      return;
    } else if (
      event.key === "d" && current?.taskId &&
      document.activeElement?.classList.contains("card")
    ) {
      event.preventDefault();
      finishTask(current.taskId);
      return;
    } else if (event.key === "?") {
      event.preventDefault();
      state.help = !state.help;
      render();
      return;
    } else return;
    if (target || event.key === "g") event.preventDefault();
    focus(target);
  });
  void loadProject().catch((error) => {
    app.textContent = `Could not load Project Kanban: ${String(error)}`;
  });
})();
