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
    drafts: new Map(),
    focusedCard: null,
    focusAdd: null,
    help: false,
  };
  let loadToken = 0;
  let refreshTimer;
  let lastG = 0;

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
    if (state.ctx?.id !== projectId) {
      state.focusedCard = null;
      state.focusAdd = null;
    }
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
    const restoreCard = document.activeElement?.classList.contains("card")
      ? state.focusedCard
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
          "j/k: next/previous card · h/l: lane · Shift+H/J/K/L: move card · gg/G: first/last · e: edit title · Enter: details · a/i: add · d: done · ?: help · Ctrl+Alt+K: List",
        ),
      );
    }
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
        renderLane(column, grouped.get(column.tagId || column.kind)),
      );
    }
    shell.append(board);
    app.replaceChildren(shell);
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
    } else if (restoreCard) {
      const card = Array.from(document.querySelectorAll(".card")).find((node) =>
        node.dataset.taskId === restoreCard.taskId
      );
      const lane = Array.from(document.querySelectorAll(".lane")).find((node) =>
        node.dataset.laneId === restoreCard.laneId
      );
      (card || lane?.querySelector(".card") ||
        document.querySelector(".card") ||
        document.querySelector(".toolbar button"))?.focus();
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
        ) || cards[0] || document.querySelector(".toolbar button"))?.focus();
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

  function renderCard(task, currentLane, nextCardId) {
    const card = el("article", "card");
    card.dataset.taskId = task.id;
    card.addEventListener("focus", () => {
      state.focusedCard = { laneId: currentLane, taskId: task.id };
    });
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute(
      "aria-label",
      `Open details for ${task.title || "Untitled task"}`,
    );
    const openDetails = () => {
      void api.selectTask(task.id).catch((error) =>
        status(String(error), true)
      );
    };
    card.addEventListener("click", openDetails);
    card.addEventListener("keydown", (event) => {
      if (event.target && event.target !== card) return;
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
    heading.append(title, titleInput);
    const autocomplete = setupSuggestions(
      titleInput,
      heading,
      currentLane,
      undefined,
      `edit-suggestions-${task.id}`,
    );
    const meta = el("div", "card-meta");
    const scheduled = BoardCore.scheduledDate(task);
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
  document.addEventListener("keydown", (event) => {
    if (
      !state.ctx || !event.ctrlKey || !event.altKey || event.shiftKey ||
      event.metaKey || event.key.toLowerCase() !== "k" ||
      event.getModifierState?.("AltGraph") ||
      event.target?.closest?.("input, textarea, select, [contenteditable]")
    ) return;
    event.preventDefault();
    void api.persistDataSynced("list", `view-${state.ctx.id}`)
      .then(() => api.closeWorkContextView())
      .catch((error) => status(String(error), true));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "g") lastG = 0;
    if (
      !state.ctx || event.ctrlKey || event.altKey || event.metaKey ||
      event.target?.closest?.(
        "input, textarea, select, button, [contenteditable]",
      ) ||
      state.settings
    ) return;
    const lanes = Array.from(document.querySelectorAll(".lane"));
    if (!lanes.length) return;
    const current = state.focusedCard;
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
      void run(async () => {
        const latest = (await api.getTasks()).find((entry) =>
          entry.id === current.taskId && entry.projectId === state.ctx?.id
        );
        if (!latest) throw new Error("Task changed or left this project.");
        await api.updateTask(latest.id, { isDone: !latest.isDone });
      });
      return;
    } else if (event.key === "?" || (event.key === "Escape" && state.help)) {
      event.preventDefault();
      state.help = event.key === "?" ? !state.help : false;
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
