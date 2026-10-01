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

    section.append(renderAddForm(lane, id));
    return section;
  }

  function renderAddForm(lane, laneId) {
    const key = `${state.ctx.id}:${state.template}:${laneId}`;
    const draft = state.drafts.get(key) || {
      title: "",
      tagIds: [],
      day: "",
      time: "",
      estimate: "",
    };
    state.drafts.set(key, draft);
    const form = el("form", "add-row");
    const main = el("div", "add-main");
    const input = el("input");
    input.type = "text";
    input.required = true;
    input.maxLength = 500;
    input.value = draft.title;
    input.placeholder = `Add to ${lane.label}`;
    input.setAttribute("aria-label", `New task in ${lane.label}`);
    const add = el("button", "", "Add");
    add.type = "submit";
    main.append(input, add);
    form.append(main);

    const suggestions = el("div", "input-suggestions");
    suggestions.id = `suggestions-${laneId}`;
    suggestions.setAttribute("role", "listbox");
    suggestions.hidden = true;
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", suggestions.id);
    input.setAttribute("aria-expanded", "false");
    form.append(suggestions);

    const actions = el("div", "add-actions");
    const dateButton = control("Schedule", () => {
      hideSuggestions();
      tagSearch.hidden = true;
      dateFields.hidden = !dateFields.hidden;
      if (!dateFields.hidden) dayInput.focus();
    });
    const tagButton = control("# Tags", () => {
      tagSearch.value = activeToken?.kind === "tag"
        ? input.value.slice(activeToken.start + 1, activeToken.end)
        : "";
      if (activeToken?.kind === "date") hideSuggestions();
      tagSearch.hidden = !tagSearch.hidden;
      if (!tagSearch.hidden) {
        tagSearch.focus();
        showSuggestions(tagSearch.value, "tag");
      } else hideSuggestions();
    });
    const estimateButton = control("Estimate", () => {
      hideSuggestions();
      tagSearch.hidden = true;
      estimateFields.hidden = !estimateFields.hidden;
      if (!estimateFields.hidden) estimateInput.focus();
    });
    actions.append(dateButton, tagButton, estimateButton);
    actions.hidden = !draft.title && !draft.tagIds.length && !draft.day &&
      !draft.estimate;
    form.append(actions);

    const chosenTags = el("div", "chosen-tags");
    function renderChosenTags() {
      chosenTags.replaceChildren();
      for (const tagId of draft.tagIds) {
        const tag = state.tags.find((item) => item.id === tagId);
        if (!tag) continue;
        const remove = control(`${tag.title} ×`, () => {
          draft.tagIds = draft.tagIds.filter((id) => id !== tagId);
          renderChosenTags();
          if (!suggestions.hidden && !tagSearch.hidden) {
            showSuggestions(tagSearch.value, "tag");
          }
        }, "chosen-tag");
        remove.setAttribute("aria-label", `Remove tag ${tag.title}`);
        chosenTags.append(remove);
      }
    }
    renderChosenTags();
    form.append(chosenTags);

    const tagSearch = el("input", "tag-search");
    tagSearch.type = "search";
    tagSearch.value = "";
    tagSearch.placeholder = "Search existing tags";
    tagSearch.setAttribute("aria-label", "Search existing tags");
    tagSearch.hidden = true;
    form.append(tagSearch);

    let activeToken = null;
    let candidates = [];
    let selectedIndex = 0;
    function hideSuggestions() {
      suggestions.hidden = true;
      input.setAttribute("aria-expanded", "false");
      activeToken = null;
    }
    function removeActiveToken() {
      if (activeToken) {
        const left = input.value.slice(0, activeToken.start).trimEnd();
        const right = input.value.slice(activeToken.end).trimStart();
        input.value = [left, right].filter(Boolean).join(" ");
        draft.title = input.value;
        input.focus();
        input.setSelectionRange(left.length, left.length);
      }
    }
    function chooseSuggestion(candidate) {
      if (candidate.tag) {
        if (draft.tagIds.includes(candidate.tag.id)) return;
        draft.tagIds.push(candidate.tag.id);
        renderChosenTags();
      } else {
        const value = BoardCore.resolveDateSuggestion(candidate.label);
        draft.day = dayInput.value = value.day;
        draft.time = timeInput.value = value.time;
        dateFields.hidden = false;
      }
      removeActiveToken();
      hideSuggestions();
      tagSearch.hidden = true;
      tagSearch.value = "";
    }
    function showSuggestions(query, kind) {
      if (kind === "date") {
        candidates = BoardCore.dateSuggestions(query).map((label) => ({
          label,
        }));
      } else {
        const laneTagIds = new Set(
          state.config.lanes.map((item) => item.tagId),
        );
        candidates = state.tags.filter((tag) =>
          tag.id !== "TODAY" && !laneTagIds.has(tag.id) &&
          !draft.tagIds.includes(tag.id) &&
          tag.title?.toLowerCase().includes(query.toLowerCase())
        ).slice(0, 10).map((tag) => ({ label: tag.title, tag }));
      }
      selectedIndex = 0;
      suggestions.replaceChildren();
      for (const [index, candidate] of candidates.entries()) {
        const option = control(
          candidate.label,
          () => chooseSuggestion(candidate),
          "suggestion-option",
        );
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === selectedIndex));
        suggestions.append(option);
      }
      if (!candidates.length) {
        suggestions.append(
          el(
            "span",
            "muted",
            kind === "date"
              ? "No matching dates. Use Schedule for a custom date and time."
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
        tagSearch.hidden = true;
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
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        chooseSuggestion(candidates[selectedIndex]);
        return true;
      }
      return false;
    }
    input.addEventListener("focus", () => {
      actions.hidden = false;
    });
    input.addEventListener("input", () => {
      draft.title = input.value;
      actions.hidden = false;
      const caret = input.selectionStart ?? input.value.length;
      const match = /(^|\s)([#@])([^#@]*)$/.exec(input.value.slice(0, caret));
      if (!match || (match[2] === "#" && /\s/.test(match[3]))) {
        hideSuggestions();
        return;
      }
      const kind = match[2] === "@" ? "date" : "tag";
      activeToken = { start: caret - match[3].length - 1, end: caret, kind };
      showSuggestions(match[3], kind);
    });
    input.addEventListener("keydown", (event) => {
      if (activeToken) navigateSuggestions(event);
    });
    tagSearch.addEventListener(
      "input",
      () => showSuggestions(tagSearch.value, "tag"),
    );
    tagSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
      if (navigateSuggestions(event) && event.key === "Escape") input.focus();
    });

    const dateFields = el("div", "add-fields");
    dateFields.hidden = !draft.day && !draft.time;
    const dayInput = el("input");
    dayInput.type = "date";
    dayInput.value = draft.day;
    dayInput.setAttribute("aria-label", "Scheduled date");
    dayInput.addEventListener("change", () => {
      draft.day = dayInput.value;
    });
    const timeInput = el("input");
    timeInput.type = "time";
    timeInput.value = draft.time;
    timeInput.setAttribute("aria-label", "Scheduled time (optional)");
    timeInput.addEventListener("change", () => {
      draft.time = timeInput.value;
    });
    for (const [label, offset] of [["Today", 0], ["Tomorrow", 1]]) {
      dateFields.append(control(label, () => {
        const next = new Date();
        next.setDate(next.getDate() + offset);
        dayInput.value = `${next.getFullYear()}-${
          String(next.getMonth() + 1).padStart(2, "0")
        }-${String(next.getDate()).padStart(2, "0")}`;
        draft.day = dayInput.value;
      }));
    }
    const clearDate = control("Clear", () => {
      dayInput.value = "";
      timeInput.value = "";
      draft.day = "";
      draft.time = "";
    });
    clearDate.setAttribute("aria-label", "Clear scheduled date and time");
    dateFields.append(dayInput, timeInput, clearDate);
    form.append(dateFields);

    const estimateFields = el("div", "add-fields");
    estimateFields.hidden = !draft.estimate;
    const estimateInput = el("input");
    estimateInput.type = "text";
    estimateInput.value = draft.estimate;
    estimateInput.placeholder = "e.g. 1h 30m";
    estimateInput.setAttribute("aria-label", "Time estimate");
    estimateInput.addEventListener("input", () => {
      draft.estimate = estimateInput.value;
    });
    for (const value of ["15m", "30m", "1h", "2h"]) {
      estimateFields.append(control(value, () => {
        estimateInput.value = draft.estimate = value;
      }));
    }
    const clearEstimate = control("Clear", () => {
      estimateInput.value = draft.estimate = "";
    });
    clearEstimate.setAttribute("aria-label", "Clear estimate");
    estimateFields.append(estimateInput, clearEstimate);
    form.append(estimateFields);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (activeToken?.kind === "date" && !suggestions.hidden) {
        const typed = input.value.slice(activeToken.start + 1, activeToken.end)
          .trim();
        const exact = candidates.find((candidate) =>
          candidate.label.toLowerCase() === typed.toLowerCase()
        );
        if (exact) chooseSuggestion(exact);
      }
      const title = draft.title.trim();
      if (!title || !state.ctx) return;
      if (/(^|\s)@/.test(title)) {
        status(
          "Select an @ date suggestion or use Schedule. Other @ expressions are not supported here.",
          true,
        );
        return;
      }
      const projectId = state.ctx.id;
      let schedule, timeEstimate;
      try {
        schedule = BoardCore.parseSchedule(draft.day, draft.time);
        timeEstimate = BoardCore.parseEstimate(draft.estimate);
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
          title,
          ...fields,
          tagIds: [...fields.tagIds, ...draft.tagIds],
          ...(schedule.dueDay ? { dueDay: schedule.dueDay } : {}),
          ...(timeEstimate ? { timeEstimate } : {}),
        });
        if (schedule.dueWithTime) {
          try {
            // PluginCreateTaskData supports all-day dates; timed dates require an update.
            await api.updateTask(taskId, {
              dueWithTime: schedule.dueWithTime,
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
      });
    });
    return form;
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
