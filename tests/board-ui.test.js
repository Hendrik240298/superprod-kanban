import { BoardCore } from "../src/board-core.js";

async function touchBoard() {
  const app = new Node("main");
  Node.root = app;
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  const tasks = [
    { id: "a", title: "First", projectId: "p", tagIds: ["extra"] },
    { id: "b", title: "Second", projectId: "p", tagIds: [] },
  ];
  const values = new Map();
  const selected = [];
  const hooks = new Map();
  const errors = [];
  const context = { id: "p", type: "PROJECT" };
  const parent = {};
  const document = {
    createElement: (tag) => new Node(tag),
    createElementNS: (_ns, tag) => new Node(tag),
    addEventListener: (key, fn) =>
      listeners.set(key, [...(listeners.get(key) || []), fn]),
    querySelectorAll: (selector) => app.querySelectorAll(selector),
    querySelector: (selector) => app.querySelector(selector),
    getElementById: (id) =>
      id === "app" ? app : descendants(app, (n) => n.id === id)[0],
    get activeElement() {
      return Node.activeElement;
    },
    elementFromPoint: () => document.hitTarget,
  };
  const api = {
    Hooks: { ANY_TASK_UPDATE: "task", WORK_CONTEXT_CHANGE: "context" },
    registerHook: (key, fn) => hooks.set(key, fn),
    getActiveWorkContext: async () => ({ ...context }),
    getAllProjects: async () => [{ id: "p", title: "Test" }],
    getAllTags: async () => [
      { id: "backlog", title: "Backlog" },
      { id: "doing", title: "Doing" },
    ],
    getTasks: async () => tasks,
    loadSyncedData: async (key) => values.get(key),
    persistDataSynced: async (value, key) => values.set(key, value),
    updateTask: async (id, patch) =>
      Object.assign(tasks.find((task) => task.id === id), patch),
    selectTask: async (id) => selected.push(id),
  };
  const source = await Deno.readTextFile(
    new URL("../src/board-ui.js", import.meta.url),
  );
  new Function(
    "window",
    "document",
    "BoardCore",
    "setTimeout",
    "clearTimeout",
    "console",
    source,
  )(
    {
      PluginAPI: api,
      parent,
      addEventListener: (key, fn) => listeners.set(`window:${key}`, fn),
    },
    document,
    BoardCore,
    (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    (id) => timers.delete(id),
    { error: (...args) => errors.push(args.join(" ")) },
  );
  await flush();
  return {
    app,
    document,
    tasks,
    values,
    selected,
    hooks,
    parent,
    context,
    api,
    errors,
    card: () => app.querySelector(".card"),
    fire: (key, event) => {
      const callbacks = listeners.get(key);
      if (Array.isArray(callbacks)) callbacks.forEach((fn) => fn(event));
      else callbacks?.(event);
    },
    hold: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((fn) => fn());
    },
    touch: (x = 30, y = 30, identifier = 1) => ({
      identifier,
      clientX: x,
      clientY: y,
    }),
  };
}

for (const shortcut of ["companion", "Shift+V", "Ctrl+Alt+K"]) {
  for (
    const scenario of [
      "normal",
      "switched",
      "returned",
      "hook-only",
      "superseded",
      "lookup-race",
    ]
  ) {
    Deno.test(`List ${shortcut} delayed save: ${scenario}`, async () => {
      const board = await touchBoard();
      board.card().focus();
      const closed = [];
      const pending = [];
      board.api.closeWorkContextView = async () =>
        closed.push(board.context.id);
      board.api.persistDataSynced = async (value, key) => {
        if (key.startsWith("view-")) {
          await new Promise((resolve) => pending.push(resolve));
        }
        board.values.set(key, value);
      };
      const toggle = () =>
        shortcut === "companion"
          ? board.fire("window:message", {
            source: board.parent,
            data: { type: "superprod-keyboard-command", command: "list" },
          })
          : board.fire("keydown", {
            key: shortcut === "Shift+V" ? "V" : "k",
            shiftKey: shortcut === "Shift+V",
            ctrlKey: shortcut === "Ctrl+Alt+K",
            altKey: shortcut === "Ctrl+Alt+K",
            target: Node.activeElement,
            preventDefault() {},
          });
      toggle();
      await flush();
      if (pending.length !== 1) throw new Error("List write was not requested");
      if (scenario === "switched") board.context.id = "q";
      if (scenario === "returned" || scenario === "hook-only") {
        for (const id of ["q", "p"]) {
          board.context.id = id;
          board.hooks.get("context")();
          if (scenario === "returned") board.hold();
          await flush();
        }
      }
      if (scenario === "superseded") {
        toggle();
        await flush();
      }
      let releaseLookup;
      if (scenario === "lookup-race") {
        board.api.getActiveWorkContext = () =>
          new Promise((resolve) =>
            releaseLookup = () => resolve({ ...board.context })
          );
      }
      pending.shift()();
      await flush();
      if (scenario === "lookup-race") {
        if (typeof releaseLookup !== "function") {
          throw new Error("List close did not revalidate the host context");
        }
        toggle();
        await flush();
        releaseLookup();
        await flush();
      }
      if (board.values.get("view-p") !== "list" || board.values.has("view-q")) {
        throw new Error("List preference was saved to the wrong project");
      }
      if (closed.length !== (scenario === "normal" ? 1 : 0)) {
        throw new Error(
          `Stale ${shortcut} closed ${closed.join(",")} in ${scenario}`,
        );
      }
      if (pending.length) {
        board.api.getActiveWorkContext = async () => ({ ...board.context });
        pending.shift()();
        await flush();
        if (closed.length !== 1) {
          throw new Error("Latest List request did not close");
        }
      }
    });
  }
}

Deno.test("holding completion after refresh never completes the next card", async () => {
  const board = await touchBoard();
  board.card().focus();
  const key = (repeat) =>
    board.fire("keydown", {
      key: "d",
      repeat,
      target: Node.activeElement,
      preventDefault() {},
    });
  key(false);
  await flush();
  key(true);
  await flush();
  if (!board.tasks[0].isDone || board.tasks[1].isDone) {
    throw new Error("Repeated completion cascaded onto the next task");
  }
  key(false);
  await flush();
  if (!board.tasks[1].isDone) throw new Error("Fresh completion was blocked");
});

Deno.test("busy title save retains the visible draft and explains rejection", async () => {
  const board = await touchBoard();
  const update = board.api.updateTask;
  let release;
  board.api.updateTask = async (...args) => {
    await new Promise((resolve) => release = resolve);
    return update(...args);
  };
  board.card().querySelector(".card-complete").click();
  await flush();
  const card = board.app.querySelectorAll(".card")[1];
  card.startEditing();
  const input = card.querySelector(".card-title-input");
  input.value = "Retain this draft";
  input.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  if (
    input.hidden || input.value !== "Retain this draft" ||
    !board.document.getElementById("board-status").textContent.includes("busy")
  ) {
    throw new Error("Busy title submission silently discarded the draft");
  }
  release();
  await flush();
  if (
    board.tasks[1].title !== "Second" ||
    board.app.querySelector(".card-title-input").value !== "Retain this draft"
  ) {
    throw new Error("Pending refresh lost or unexpectedly saved the draft");
  }
});

Deno.test("menu saves retain drafts while busy or rejected and allow retry", async () => {
  const board = await touchBoard();
  let release;
  const update = board.api.updateTask;
  board.api.updateTask = async (...args) => {
    await new Promise((resolve) => release = resolve);
    return update(...args);
  };
  board.card().querySelector(".card-complete").click();
  await flush();
  const card = board.app.querySelectorAll(".card")[1];
  card.querySelector(".card-actions").click();
  descendants(
    board.app,
    (n) => n.className === "card-menu-label" && n.textContent === "Add subtask",
  )[0].closest("button").click();
  let form = board.app.querySelector(".card-menu-form");
  let input = form.querySelector("input");
  input.value = "Subtask draft";
  const submit = () => form.fire("submit", { preventDefault() {} });
  submit();
  await flush();
  if (
    !form.isConnected || input.value !== "Subtask draft" ||
    !board.app.querySelector(".card-menu-form-error").textContent.includes(
      "busy",
    )
  ) {
    throw new Error("Busy menu submission silently closed the draft");
  }
  release();
  await flush();
  // Reopen if this refresh closed the form (refresh preservation is a separate test).
  if (!form.isConnected) {
    board.card().querySelector(".card-actions").click();
    descendants(
      board.app,
      (n) =>
        n.className === "card-menu-label" && n.textContent === "Add subtask",
    )[0].closest("button").click();
    form = board.app.querySelector(".card-menu-form");
    input = form.querySelector("input");
    input.value = "Subtask draft";
  }
  board.api.addTask = async () => {
    throw new Error("Offline");
  };
  submit();
  await flush();
  if (!form.isConnected || input.value !== "Subtask draft") {
    throw new Error("Failed save lost menu draft");
  }
  const added = [];
  board.api.addTask = async (fields) => {
    added.push(fields);
    return "new-child";
  };
  submit();
  await flush();
  if (
    board.app.querySelector(".card-menu-form") || added.length !== 1 ||
    added[0].parentId !== "b"
  ) {
    throw new Error("Retry did not save the retained menu draft exactly once");
  }
});

Deno.test("same-project refresh keeps menu draft and focus but stale targets cannot save", async () => {
  for (const change of ["refresh", "deleted", "moved", "project"]) {
    const board = await touchBoard();
    board.card().querySelector(".card-actions").click();
    descendants(
      board.app,
      (n) =>
        n.className === "card-menu-label" && n.textContent === "Add subtask",
    )[0].closest("button").click();
    const input = board.app.querySelector(".card-menu-form input");
    input.value = "Keep menu draft";
    input.focus();
    if (change === "deleted") board.tasks.shift();
    if (change === "moved") board.tasks[0].projectId = "q";
    if (change === "project") board.context.id = "q";
    board.hooks.get("task")();
    board.hold();
    await flush();
    const restored = board.app.querySelector(".card-menu-form input");
    if (change === "refresh") {
      if (
        restored?.value !== "Keep menu draft" || Node.activeElement !== restored
      ) {
        throw new Error("Same-project refresh discarded menu draft or focus");
      }
    } else if (restored) throw new Error("Stale menu target survived refresh");
  }
});

Deno.test("valid inline blur commits once; Enter followed by blur never resubmits", async () => {
  for (const enter of [false, true]) {
    const board = await touchBoard();
    const update = board.api.updateTask;
    const writes = [];
    board.api.updateTask = async (...args) => {
      writes.push(args);
      return update(...args);
    };
    const card = board.card();
    card.startEditing();
    const input = card.querySelector(".card-title-input");
    input.value = "Saved on blur";
    if (enter) {
      input.fire("keydown", {
        key: "Enter",
        preventDefault() {},
        stopPropagation() {},
      });
    }
    input.fire("blur");
    await flush();
    if (board.tasks[0].title !== "Saved on blur" || writes.length !== 1) {
      throw new Error("Blur lost the title or double-submitted Enter");
    }
  }
});

Deno.test("invalid and failed blur drafts survive unfocused refresh; Escape cancels", async () => {
  for (const failure of ["invalid", "failed", "escape"]) {
    const board = await touchBoard();
    const update = board.api.updateTask;
    let writes = 0;
    board.api.updateTask = async (...args) => {
      writes++;
      if (failure === "failed") throw new Error("Offline title save");
      return update(...args);
    };
    const card = board.card();
    card.startEditing();
    const input = card.querySelector(".card-title-input");
    const draft = failure === "invalid"
      ? "Title @every Friday"
      : "Unsaved title";
    input.value = draft;
    if (failure === "escape") {
      input.fire("keydown", {
        key: "Escape",
        preventDefault() {},
        stopPropagation() {},
      });
    }
    input.fire("blur");
    board.app.querySelector(".task-add-input").focus();
    await flush();
    board.hooks.get("task")();
    board.hold();
    await flush();
    const restored = board.card().querySelector(".card-title-input");
    if (failure === "escape") {
      if (!restored.hidden || writes) {
        throw new Error("Escape saved a cancelled title");
      }
    } else if (
      restored.hidden || restored.value !== draft ||
      board.tasks[0].title !== "First"
    ) {
      throw new Error("Unfocused refresh lost a rejected title draft");
    }
  }
});

for (const action of ["circle", "d"]) {
  for (const kind of ["ordinary", "recurring", "parent"]) {
    Deno.test(`${action} completion of ${kind} task is silent and preserves data/focus`, async () => {
      const board = await touchBoard();
      const task = board.tasks[0];
      task.dueDay = "2026-11-09";
      if (kind === "recurring") task.repeatCfgId = "repeat";
      if (kind === "parent") task.subTaskIds = ["child"];
      const expected = JSON.stringify({ ...task, isDone: true });
      board.card().focus();
      if (action === "circle") {
        board.card().querySelector(".card-complete").click();
      } else {board.fire("keydown", {
          key: "d",
          target: Node.activeElement,
          preventDefault() {},
        });}
      await flush();
      if (
        JSON.stringify(task) !== expected ||
        board.card()?.dataset.taskId !== "b" ||
        Node.activeElement?.dataset.taskId !== "b"
      ) {
        throw new Error(
          "Completion lost task data or did not focus the remaining card",
        );
      }
      for (const refresh of [false, true]) {
        if (refresh) {
          board.hooks.get("task")();
          board.hold();
          await flush();
        }
        if (
          board.app.querySelector(".completion-feedback") ||
          board.app.querySelector(".completion-undo") ||
          board.document.getElementById("board-status").textContent ||
          descendants(board.app, (node) => node.textContent === "Undo").length
        ) {
          throw new Error(
            "Completion left persistent feedback or board-local Undo UI",
          );
        }
      }
    });
  }
}

Deno.test("pending title and menu saves revalidate latest task and active project", async () => {
  for (const action of ["title", "subtask", "complete"]) {
    for (const change of ["context", "deleted", "moved", "done", "child"]) {
      const board = await touchBoard();
      const card = board.card();
      if (action === "title") card.startEditing();
      if (action === "subtask") {
        card.querySelector(".card-actions").click();
        descendants(
          board.app,
          (n) =>
            n.className === "card-menu-label" &&
            n.textContent === "Add subtask",
        )[0].closest("button").click();
      }
      if (change === "context") board.context.id = "q";
      if (change === "deleted") board.tasks.shift();
      if (change === "moved") board.tasks[0].projectId = "q";
      if (change === "done") board.tasks[0].isDone = true;
      if (change === "child") board.tasks[0].parentId = "parent";
      let writes = 0;
      board.api.updateTask = board.api.addTask = async () => {
        writes++;
        return "new";
      };
      if (action === "title") {
        const input = card.querySelector(".card-title-input");
        input.value = "Stale title";
        input.fire("blur");
      } else if (action === "subtask") {
        const form = board.app.querySelector(".card-menu-form");
        form.querySelector("input").value = "Stale subtask";
        form.fire("submit", { preventDefault() {} });
      } else card.querySelector(".card-complete").click();
      await flush();
      if (writes) throw new Error(`${action} saved against ${change} target`);
    }
  }
});

Deno.test("board opens native focus setup through awaited allowed APIs, not session start", async () => {
  const board = await touchBoard();
  const calls = [];
  board.api.startTracking = async (id) => {
    await Promise.resolve();
    calls.push(["track", id]);
  };
  board.api.dispatchAction = async (action) => {
    await Promise.resolve();
    calls.push(["dispatch", action.type]);
  };
  board.card().querySelector(".card-actions").click();
  const focus = descendants(
    board.app,
    (n) =>
      n.className === "card-menu-label" &&
      n.textContent === "Open focus setup",
  )[0];
  if (!focus) throw new Error("Missing verified native focus setup action");
  focus.closest("button").click();
  await flush();
  if (
    JSON.stringify(calls) !==
      JSON.stringify([["track", "a"], [
        "dispatch",
        "[FocusMode] Show Overlay",
      ]]) ||
    !board.document.getElementById("board-status").textContent.includes("timer")
  ) {
    throw new Error(
      "Focus setup did not await tracking/allowed overlay or misreported timer start",
    );
  }
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("../src/manifest.json", import.meta.url)),
  );
  for (const permission of ["startTracking", "dispatchAction"]) {
    if (!manifest.permissions.includes(permission)) {
      throw new Error(`Missing ${permission} permission`);
    }
  }
});

Deno.test("focus setup awaits rejected bridge actions and reports partial tracking with List fallback", async () => {
  for (const mode of ["legacy", "rejected", "tracking-rejected"]) {
    const board = await touchBoard();
    const calls = [];
    board.api.startTracking = async () => {
      await Promise.resolve();
      if (mode === "tracking-rejected") throw new Error("Tracking unavailable");
    };
    board.api.dispatchAction = async (action) => {
      await Promise.resolve();
      calls.push(action.type);
      if (action.type === "[FocusMode] Show Overlay" || mode === "rejected") {
        throw new Error("Action not allowed");
      }
    };
    board.api.closeWorkContextView = async () => {};
    board.card().querySelector(".card-actions").click();
    descendants(
      board.app,
      (n) =>
        n.className === "card-menu-label" &&
        n.textContent === "Open focus setup",
    )[0].closest("button").click();
    await flush();
    const message = board.document.getElementById("board-status").textContent;
    if (mode === "legacy") {
      if (
        JSON.stringify(calls) !==
          JSON.stringify([
            "[FocusMode] Show Overlay",
            "[FocusMode] Show Focus Overlay",
          ]) || !message.includes("opened")
      ) {
        throw new Error(
          "Async bridge rejection did not trigger legacy setup fallback",
        );
      }
    } else {
      if (
        !message.includes(
          mode === "rejected" ? "tracking started" : "not started",
        ) ||
        (mode === "tracking-rejected" && calls.length)
      ) throw new Error("Focus failure hid its tracking stage");
      const fallback = board.app.querySelector(".focus-list-fallback");
      if (!fallback) {
        throw new Error("Rejected setup left no explicit native List fallback");
      }
      fallback.click();
      await flush();
      if (board.values.get("view-p") !== "list" || board.selected[0] !== "a") {
        throw new Error("List fallback did not navigate");
      }
    }
  }
});

Deno.test("unsupported menu actions describe navigation, with a consistent List indicator", async () => {
  const board = await touchBoard();
  board.card().querySelector(".card-actions").click();
  for (
    const label of [
      "Open in List for focus…",
      "Open in List to duplicate…",
      "Set priority in List…",
    ]
  ) {
    const item = descendants(
      board.app,
      (n) => n.className === "card-menu-label" && n.textContent === label,
    )[0]?.closest("button");
    if (
      !item || item.querySelector(".card-menu-hint")?.textContent !== "List ↗"
    ) {
      throw new Error(`Unsupported action still promises execution: ${label}`);
    }
  }
});

Deno.test("quick-add has no persistent instruction banner or dangling help reference", async () => {
  const board = await touchBoard();
  if (board.app.querySelector(".quick-add-help")) {
    throw new Error("Unwanted persistent quick-add instructions remain");
  }
  if (
    board.app.querySelector(".task-add-input").getAttribute(
      "aria-describedby",
    )
  ) {
    throw new Error("Removed help left a dangling accessibility reference");
  }
});

Deno.test("action menu supports hjkl without taking text or modified shortcuts", async () => {
  const board = await touchBoard();
  board.card().querySelector(".card-actions").click();
  const menu = board.app.querySelector(".card-menu");
  const buttons = menu.querySelectorAll("button");
  buttons[0].focus();
  const key = (value, options = {}) =>
    menu.fire("keydown", {
      key: value,
      target: Node.activeElement,
      preventDefault() {},
      stopPropagation() {},
      ...options,
    });
  key("j");
  if (Node.activeElement !== buttons[1]) throw new Error("j did not move down");
  key("k");
  if (Node.activeElement !== buttons[0]) throw new Error("k did not move up");
  key("j", { ctrlKey: true });
  if (Node.activeElement !== buttons[0]) throw new Error("Stole modified j");
  const estimate = descendants(
    menu,
    (n) => n.className === "card-menu-label" && n.textContent === "Estimate",
  )[0].closest("button");
  estimate.focus();
  key("l");
  if (!menu.querySelector(".card-menu-back")) {
    throw new Error("l did not open submenu");
  }
  key("h");
  if (menu.querySelector(".card-menu-back")) {
    throw new Error("h did not return");
  }
  descendants(
    menu,
    (n) => n.className === "card-menu-label" && n.textContent === "Add subtask",
  )[0].closest("button").click();
  const input = menu.querySelector("input");
  input.focus();
  for (const value of ["h", "j", "k", "l"]) {
    key(value, {
      preventDefault() {
        throw new Error("Stole typed " + value);
      },
    });
  }
  if (Node.activeElement !== input) throw new Error("Typing moved menu focus");
});

Deno.test("title draft never follows a moved task into another project", async () => {
  const board = await touchBoard();
  board.card().startEditing();
  board.card().querySelector(".card-title-input").value =
    "Private old-project draft";
  board.tasks[0].projectId = "q";
  board.context.id = "q";
  board.hooks.get("task")();
  board.hold();
  await flush();
  if (!board.card().querySelector(".card-title-input").hidden) {
    throw new Error(
      "Old-project title draft was restored against a moved task",
    );
  }
});

Deno.test("accepted title save stays single across a local rerender", async () => {
  const board = await touchBoard();
  let release;
  const update = board.api.updateTask;
  let writes = 0;
  board.api.updateTask = async (...args) => {
    writes++;
    await new Promise((resolve) => release = resolve);
    return update(...args);
  };
  board.card().startEditing();
  const input = board.card().querySelector(".card-title-input");
  input.value = "Accepted title";
  input.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  await flush();
  descendants(
    board.app,
    (n) => n.tag === "button" && n.textContent === "Configure lanes",
  )[0].click();
  board.card().querySelector(".card-title-input").fire("blur");
  release();
  await flush();
  if (
    !board.card().querySelector(".card-title-input").hidden || writes !== 1 ||
    board.tasks[0].title !== "Accepted title"
  ) {
    throw new Error(
      "A rerender resurrected or duplicated an accepted title save",
    );
  }
});

Deno.test("created subtask is accepted even if opening native details fails", async () => {
  const board = await touchBoard();
  const added = [];
  board.api.addTask = async (fields) => {
    added.push(fields);
    return "child";
  };
  board.api.selectTask = async () => {
    throw new Error("Panel unavailable");
  };
  board.card().querySelector(".card-actions").click();
  descendants(
    board.app,
    (n) => n.className === "card-menu-label" && n.textContent === "Add subtask",
  )[0].closest("button").click();
  const form = board.app.querySelector(".card-menu-form");
  form.querySelector("input").value = "Created once";
  form.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 1 || board.app.querySelector(".card-menu-form") ||
    !board.document.getElementById("board-status").textContent.includes(
      "Subtask created",
    )
  ) {
    throw new Error(
      "Partial selection failure encouraged a duplicate subtask submission",
    );
  }
});

Deno.test("accepted menu mutation is not offered for retry when only refresh fails", async () => {
  const board = await touchBoard();
  let added = 0;
  board.api.addTask = async () => {
    added++;
    board.api.getAllTags = async () => {
      throw new Error("Refresh offline");
    };
    return "child";
  };
  board.card().querySelector(".card-actions").click();
  descendants(
    board.app,
    (n) => n.className === "card-menu-label" && n.textContent === "Add subtask",
  )[0].closest("button").click();
  const form = board.app.querySelector(".card-menu-form");
  form.querySelector("input").value = "Accepted mutation";
  form.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added !== 1 || board.app.querySelector(".card-menu-form") ||
    !board.document.getElementById("board-status").textContent.includes("Saved")
  ) {
    throw new Error("A refresh failure was misreported as a rejected mutation");
  }
});

Deno.test("iframe refocus restores the card after a background refresh", async () => {
  const board = await touchBoard();
  board.card().focus();
  Node.activeElement = new Node("body");
  board.hooks.get("task")();
  board.hold();
  await flush();
  board.fire("window:focus");
  if (Node.activeElement !== board.card()) {
    throw new Error(
      "Returning from native details lost the focused Kanban card",
    );
  }
});

Deno.test("Android long-press does not open the card context menu", async () => {
  const board = await touchBoard();
  const card = board.card();
  card.fire("touchstart", { target: card, touches: [board.touch()] });
  card.fire("contextmenu", {
    target: card,
    pointerType: "touch",
    preventDefault() {},
    clientX: 30,
    clientY: 30,
  });
  if (board.app.querySelector(".card-menu")) {
    throw new Error(
      "Android long-press opened actions instead of allowing drag",
    );
  }
});

Deno.test("cards have explicit actions without opening task details", async () => {
  const board = await touchBoard();
  const card = board.card();
  const button = card.querySelector(".card-actions");
  if (!button || button.getAttribute("aria-haspopup") !== "menu") {
    throw new Error("Missing explicit task-actions button for touch users");
  }
  let stopped = false;
  button.fire("click", {
    stopPropagation() {
      stopped = true;
    },
  });
  if (
    !board.app.querySelector(".card-menu") || !stopped || board.selected.length
  ) {
    throw new Error("Actions button did not open only the actions menu");
  }
});

Deno.test("hold then drag moves a touch card without opening details", async () => {
  const board = await touchBoard();
  const card = board.card();
  const destination = board.app.querySelectorAll(".lane")[1];
  board.document.hitTarget = destination;
  card.fire("touchstart", { target: card, touches: [board.touch()] });
  board.hold();
  if (!board.app.querySelector(".touch-drag-preview")) {
    throw new Error("Holding did not lift the card for touch drag");
  }
  let prevented = false;
  board.fire("touchmove", {
    touches: [board.touch(200, 80)],
    cancelable: true,
    preventDefault() {
      prevented = true;
    },
  });
  board.fire("touchend", { changedTouches: [board.touch(200, 80)] });
  card.fire("click", { preventDefault() {}, stopPropagation() {} });
  await flush();
  if (
    !prevented || board.selected.length ||
    JSON.stringify(board.tasks[0].tagIds) !==
      JSON.stringify(["extra", "doing"]) ||
    JSON.parse(board.values.get("order-simple-p") || "{}").doing?.[0] !== "a" ||
    board.app.querySelector(".touch-drag-preview")
  ) {
    throw new Error(
      "Touch drop failed, lost unrelated tags, or opened task details",
    );
  }
});

Deno.test("leaving a project cancels a lifted touch card", async () => {
  const board = await touchBoard();
  const card = board.card();
  card.fire("touchstart", { target: card, touches: [board.touch()] });
  board.hold();
  board.context.type = "TAG";
  board.hooks.get("context")();
  board.hold();
  await flush();
  if (card.classList.contains("touch-drag-source") || !card.draggable) {
    throw new Error("Leaving project left a stale active touch drag");
  }
});

Deno.test("touch reordering preserves unrelated task tags", async () => {
  const board = await touchBoard();
  const card = board.card();
  board.document.hitTarget = card.closest(".lane");
  card.fire("touchstart", { target: card, touches: [board.touch()] });
  board.hold();
  board.fire("touchmove", {
    touches: [board.touch(30, 90)],
    cancelable: true,
    preventDefault() {},
  });
  board.fire("touchend", { changedTouches: [board.touch(30, 90)] });
  await flush();
  if (
    JSON.stringify(JSON.parse(board.values.get("order-simple-p")).backlog) !==
      '["b","a"]' ||
    !board.tasks[0].tagIds.includes("extra")
  ) throw new Error("Touch reorder failed or changed task metadata");
});

Deno.test("swipe before hold leaves native scrolling alone", async () => {
  const board = await touchBoard();
  const card = board.card();
  card.fire("touchstart", { target: card, touches: [board.touch()] });
  board.fire("touchmove", {
    touches: [board.touch(30, 100)],
    cancelable: true,
    preventDefault() {
      throw new Error("Swipe scrolling was blocked");
    },
  });
  board.hold();
  if (
    board.app.querySelector(".touch-drag-preview") || !card.draggable ||
    board.values.size
  ) {
    throw new Error("Swipe activated a drag instead of scrolling");
  }
});

Deno.test("short taps still open details and do not move tasks", async () => {
  const board = await touchBoard();
  const card = board.card();
  card.fire("touchstart", { target: card, touches: [board.touch()] });
  board.fire("touchend", { changedTouches: [board.touch()] });
  card.fire("click", { detail: 1 });
  await flush();
  if (JSON.stringify(board.selected) !== '["a"]' || board.values.size) {
    throw new Error("Ordinary touch tap was lost or moved a task");
  }
});

Deno.test("cancelled, stationary, outside and multi-touch drags do not persist moves", async () => {
  for (const ending of ["touchcancel", "stationary", "outside", "multi"]) {
    const board = await touchBoard();
    const card = board.card();
    card.fire("touchstart", { target: card, touches: [board.touch()] });
    board.hold();
    if (ending === "multi") {
      board.fire("touchstart", {
        touches: [board.touch(), board.touch(40, 40, 2)],
      });
    } else if (ending === "touchcancel") board.fire("touchcancel", {});
    else {
      if (ending === "outside") {
        board.fire("touchmove", {
          touches: [board.touch(300, 100)],
          cancelable: true,
          preventDefault() {},
        });
      }
      board.fire("touchend", { changedTouches: [board.touch()] });
    }
    board.hold();
    if (
      board.values.size || board.app.querySelector(".touch-drag-preview") ||
      !card.draggable
    ) {
      throw new Error(
        `${ending} drag persisted a move or left stale drag state`,
      );
    }
  }
});

Deno.test("touch on controls never starts dragging; mouse right-click still works", async () => {
  const board = await touchBoard();
  const card = board.card();
  for (
    const selector of [".card-actions", ".card-complete", ".card-title-input"]
  ) {
    card.fire("touchstart", {
      target: card.querySelector(selector),
      touches: [board.touch()],
    });
    board.hold();
    if (board.app.querySelector(".touch-drag-preview")) {
      throw new Error(`${selector} started a drag`);
    }
  }
  card.fire("contextmenu", { target: card, preventDefault() {} });
  if (board.app.querySelector(".card-menu")) {
    throw new Error("Legacy touch contextmenu opened actions");
  }
  card.fire("contextmenu", {
    target: card,
    pointerType: "mouse",
    preventDefault() {},
  });
  if (!board.app.querySelector(".card-menu")) {
    throw new Error("Mouse right-click stopped working after touch input");
  }
});

class Node {
  constructor(tag = "div") {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = "";
    this.className = "";
    this.classList = {
      add: (...names) => {
        this.className = [
          ...new Set([...this.className.split(" ").filter(Boolean), ...names]),
        ].join(" ");
      },
      remove: (...names) => {
        this.className = this.className.split(" ").filter((name) =>
          !names.includes(name)
        ).join(" ");
      },
      toggle: (name, force) => {
        if (force ?? !this.classList.contains(name)) this.classList.add(name);
        else this.classList.remove(name);
      },
      contains: (name) => this.className.split(" ").includes(name),
    };
    this.dataset = {};
    this.style = {};
    this.offsetHeight = 100;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
  remove() {
    const parent =
      descendants(Node.root, (node) => node.children.includes(this))[0];
    if (parent) {
      parent.children = parent.children.filter((node) => node !== this);
    }
  }
  contains(node) {
    return descendants(this, (entry) => entry === node).length > 0;
  }
  get isConnected() {
    return this.contains(this) &&
      !!descendants(Node.root, (node) => node === this).length;
  }
  get lastChild() {
    return this.children.at(-1);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  removeAttribute(key) {
    delete this.attributes[key];
  }
  getAttribute(key) {
    return this.attributes[key] || null;
  }
  addEventListener(key, fn) {
    this.listeners[key] = fn;
  }
  getBoundingClientRect() {
    return { top: 0 };
  }
  fire(key, event = {}) {
    this.listeners[key]?.(event);
  }
  click() {
    this.fire("click", { stopPropagation() {} });
  }
  focus() {
    Node.activeElement = this;
    this.fire("focus");
  }
  querySelectorAll(selector) {
    if (selector.includes(", ")) {
      return [
        ...new Set(
          selector.split(", ").flatMap((part) => this.querySelectorAll(part)),
        ),
      ];
    }
    const [parent, child] = selector.split(" ");
    const match = (node, part) =>
      part.startsWith(".")
        ? node.className.split(" ").includes(part.slice(1))
        : node.tag === part;
    return descendants(
      this,
      (node) =>
        node !== this && match(node, child || parent) &&
        (!child || descendants(this, (ancestor) =>
          ancestor !== node && match(ancestor, parent) &&
          descendants(ancestor, (entry) =>
            entry === node).length).length),
    );
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  closest(selector) {
    if (
      selector.split(", ").some((part) =>
        part.startsWith(".")
          ? this.classList.contains(part.slice(1))
          : part === this.tag
      )
    ) return this;
    const parent =
      descendants(Node.root, (node) => node.children.includes(this))[0];
    return parent?.closest(selector) || null;
  }
  scrollIntoView() {}
  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

function descendants(node, predicate) {
  return [
    node,
    ...node.children.flatMap((child) => descendants(child, predicate)),
  ]
    .filter(predicate);
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

Deno.test("iframe switches templates and saves drag ordering inside Clarify", async () => {
  const source = await Deno.readTextFile(
    new URL("../src/board-ui.js", import.meta.url),
  );
  const app = new Node("main");
  Node.root = app;
  app.id = "app";
  const documentListeners = new Map();
  const document = {
    createElement: (tag) => new Node(tag),
    createElementNS: (_namespace, tag) => new Node(tag),
    addEventListener: (key, fn) =>
      documentListeners.set(key, [
        ...(documentListeners.get(key) || []),
        fn,
      ]),
    querySelectorAll: (selector) => app.querySelectorAll(selector),
    querySelector: (selector) => app.querySelector(selector),
    get activeElement() {
      return Node.activeElement;
    },
    getElementById: (id) =>
      descendants(app, (node) => node.id === id)[0] || null,
  };
  const oldSettings = JSON.stringify({ lanes: [{ tagId: "progress" }] });
  const values = new Map([
    ["template-p", "classic"],
    ["lanes-p", oldSettings],
  ]);
  const tags = [
    { id: "progress", title: "In Progress" },
    { id: "extra", title: "Extra" },
    { id: "focus", title: "Focus Time" },
  ];
  const tasks = [
    {
      id: "a",
      title: "First",
      projectId: "p",
      tagIds: [],
      isDone: false,
      dueDay: "2026-10-08",
      timeEstimate: 5400000,
      subTaskIds: ["sub"],
    },
    {
      id: "b",
      title: "Second",
      projectId: "p",
      tagIds: [],
      isDone: false,
      dueWithTime: new Date(2026, 9, 9, 14, 30).getTime(),
    },
    {
      id: "sub",
      title: "Child",
      projectId: "p",
      parentId: "a",
      tagIds: [],
      isDone: false,
    },
    {
      id: "finished",
      title: "Finished",
      projectId: "p",
      tagIds: [],
      isDone: true,
    },
  ];
  const updates = [];
  const added = [];
  const selected = [];
  const closed = [];
  const errors = [];
  const hooks = new Map();
  const api = {
    Hooks: {
      ANY_TASK_UPDATE: "anyTaskUpdate",
      WORK_CONTEXT_CHANGE: "workContextChange",
      PERSISTED_DATA_CHANGED: "persistedDataChanged",
    },
    registerHook: (hook, cb) => hooks.set(hook, cb),
    getActiveWorkContext: async () => ({
      id: "p",
      type: "PROJECT",
      title: "Sample",
    }),
    getAllTags: async () => [...tags],
    getTasks: async () => [...tasks],
    getAllProjects: async () => [
      { id: "p", title: "Sample", backlogTaskIds: [] },
      { id: "q", title: "Other", backlogTaskIds: [] },
    ],
    loadSyncedData: async (key) => values.get(key) || null,
    persistDataSynced: async (value, key) => {
      values.set(key, value);
    },
    addTag: async ({ title }) => {
      const id = `tag-${tags.length}`;
      tags.push({ id, title });
      return id;
    },
    updateTask: async (id, patch) => {
      updates.push({ id, patch });
      Object.assign(tasks.find((task) => task.id === id), patch);
    },
    deleteTask: async (id) => {
      const index = tasks.findIndex((task) => task.id === id);
      if (index < 0) throw new Error("Task not found");
      tasks.splice(index, 1);
    },
    addTask: async (fields) => {
      added.push(fields);
      const id = `new-${added.length}`;
      tasks.push({ id, ...fields });
      return id;
    },
    selectTask: async (id) => {
      selected.push(id);
    },
    closeWorkContextView: () => closed.push(true),
    log: { err: () => {} },
  };
  new Function("window", "document", "BoardCore", "console", source)(
    { PluginAPI: api, addEventListener() {} },
    document,
    BoardCore,
    { error: (...args) => errors.push(args.join(" ")) },
  );
  await flush();
  if (document.activeElement?.className !== "board") {
    throw new Error("Board did not start with a predictable focus target");
  }
  if (
    values.get("lanes-p") !== oldSettings ||
    values.get("template-p") !== "classic"
  ) {
    throw new Error("Opening legacy Classic changed stored settings");
  }
  const simpleLanes = descendants(app, (node) => node.className === "lane");
  if (
    JSON.stringify(simpleLanes.map((node) => node.attributes["aria-label"])) !==
      JSON.stringify(["Backlog", "Doing"]) ||
    descendants(app, (node) => node.tag === "article").length !== 2 ||
    !descendants(app, (node) =>
      node.className === "meta-chip" &&
      node.textContent === "1 subtasks").length
  ) {
    throw new Error(
      "Simple board must hide completed/subtask cards and keep parent count",
    );
  }
  if (
    tags.some((tag) => tag.title === "In Progress" && tag.id !== "progress")
  ) {
    throw new Error("Simple board created a legacy In Progress tag");
  }
  if (
    descendants(
      app,
      (node) => node.tag === "h1" || node.textContent === "List view",
    ).length
  ) {
    throw new Error("Redundant project heading or List button rendered");
  }
  const configure = descendants(
    app,
    (node) => node.tag === "button" && node.textContent === "Configure lanes",
  )[0];
  if (
    !configure ||
    descendants(app, (node) => node.className === "template-picker").length
  ) {
    throw new Error("Template picker should be behind Configure lanes");
  }
  const dates = descendants(
    app,
    (node) => node.className === "schedule-date",
  ).map((node) => node.textContent);
  const schedules = descendants(
    app,
    (node) => node.className.startsWith("schedule-indicator"),
  );
  const estimates = descendants(
    app,
    (node) => node.className === "card-estimate",
  );
  const expectedDate = new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(2026, 9, 8));
  if (
    schedules.length !== 2 || dates[0] !== expectedDate ||
    schedules[1].className !== "schedule-indicator timed" ||
    !schedules[1].attributes["aria-label"].includes("2026") ||
    estimates.length !== 1 || estimates[0].textContent !== "1h 30m" ||
    descendants(app, (node) =>
      node.className === "meta-chip" &&
      /Scheduled|Est\./.test(node.textContent)).length
  ) {
    throw new Error(
      `Expected native-style schedule and estimate indicators: ${
        JSON.stringify(dates)
      }`,
    );
  }
  configure.fire("click");
  const picker =
    descendants(app, (node) => node.className === "template-picker")[0];
  if (
    !picker ||
    descendants(
        app,
        (node) => node.tag === "section" && node.className === "lane",
      ).length !== 2
  ) {
    throw new Error("Simple board did not render");
  }
  picker.value = "workflow";
  picker.fire("change");
  await flush();
  if (values.get("template-p") !== "workflow" || tags.length !== 9) {
    throw new Error("Workflow template did not initialize its six tag lanes");
  }
  if (
    !tags.some((tag) => tag.title === "This-Week") ||
    !tags.some((tag) => tag.title === "Maybe-Later") ||
    tags.some((tag) => ["This Week", "Maybe/Later"].includes(tag.title))
  ) {
    throw new Error("New Workflow tag names must work as single # tokens");
  }
  const lanes = descendants(
    app,
    (node) => node.tag === "section" && node.className === "lane",
  );
  if (lanes.length !== 7 || lanes[0].attributes["aria-label"] !== "Clarify") {
    throw new Error("Expected seven workflow lanes starting with Clarify");
  }
  if (
    lanes[2].attributes["aria-label"] !== "This Week" ||
    lanes[6].attributes["aria-label"] !== "Maybe/Later"
  ) {
    throw new Error("Workflow kept tag slugs in human-readable lane labels");
  }
  const cards = descendants(lanes[0], (node) => node.tag === "article");
  if (cards.length !== 2) throw new Error("Expected both tasks in Clarify");
  cards[1].fire("drop", {
    preventDefault() {},
    stopPropagation() {},
    clientY: 90,
    dataTransfer: { getData: () => "a" },
  });
  await flush();
  const order = JSON.parse(values.get("order-workflow-p"));
  if (JSON.stringify(order.todo) !== JSON.stringify(["b", "a"])) {
    throw new Error(
      `Wrong saved within-lane order: ${JSON.stringify(order.todo)}`,
    );
  }
  if (updates.length) throw new Error("Reordering mutated native tasks");
  if (values.has("view-p")) {
    throw new Error("Board settings must not switch work views");
  }
  descendants(
    app,
    (node) => node.tag === "button" && node.textContent === "Close settings",
  )[0].fire("click");
  const key = (target, key, shiftKey = false) => {
    for (const fn of documentListeners.get("keydown") || []) {
      fn({ key, shiftKey, target, preventDefault() {} });
    }
  };
  const cardById = (id) =>
    descendants(
      app,
      (node) => node.tag === "article" && node.dataset.taskId === id,
    )[0];
  cardById("a").focus();
  key(cardById("a"), "K", true);
  await flush();
  if (
    JSON.stringify(JSON.parse(values.get("order-workflow-p")).todo) !==
      JSON.stringify(["a", "b"])
  ) {
    throw new Error("Shift+K did not move the card up");
  }
  key(cardById("a"), "J", true);
  await flush();
  if (
    JSON.stringify(JSON.parse(values.get("order-workflow-p")).todo) !==
      JSON.stringify(["b", "a"]) || updates.length
  ) {
    throw new Error(
      "Shift+J did not move the card down without changing task data",
    );
  }
  const currentCards = descendants(app, (node) => node.tag === "article");
  if (
    currentCards.length !== 2 ||
    currentCards.some((card) =>
      card.attributes.role !== "group" || card.tabIndex !== 0 ||
      descendants(card, (node) => node.tag === "details").length ||
      descendants(card, (node) => node.className === "card-complete").length !==
        1
    )
  ) {
    throw new Error(
      "Cards should open task details without extra action menus",
    );
  }
  currentCards[0].focus();
  key(currentCards[0], "Escape");
  if (document.activeElement?.className !== "board") {
    throw new Error("Escape did not leave card navigation inside Kanban");
  }
  key(document.activeElement, "j");
  if (document.activeElement !== currentCards[0]) {
    throw new Error("j did not enter card navigation from board focus");
  }
  key(currentCards[0], "j");
  if (document.activeElement !== currentCards[1]) {
    throw new Error("j did not focus next card");
  }
  key(currentCards[1], "k");
  if (document.activeElement !== currentCards[0]) {
    throw new Error("k did not focus previous card");
  }
  key(currentCards[0], "G");
  if (document.activeElement !== currentCards[1]) {
    throw new Error("G did not focus last card");
  }
  key(currentCards[1], "g");
  key(currentCards[1], "g");
  if (document.activeElement !== currentCards[0]) {
    throw new Error("gg did not focus first card");
  }
  key(currentCards[0], "a");
  if (document.activeElement?.tag !== "input") {
    throw new Error("a did not focus quick add");
  }
  key(document.activeElement, "j");
  if (document.activeElement?.tag !== "input") {
    throw new Error("Navigation stole a typing key");
  }
  document.activeElement.fire("keydown", {
    key: "Escape",
    preventDefault() {},
  });
  if (document.activeElement !== currentCards[0]) {
    throw new Error("Escape did not restore card focus");
  }
  key(currentCards[0], "Escape");
  if (document.activeElement?.className !== "board") {
    throw new Error("A second Escape did not leave card navigation");
  }
  key(document.activeElement, "j");
  currentCards[0].fire("click");
  currentCards[1].fire("keydown", { key: "Enter", preventDefault() {} });
  currentCards[0].fire("keydown", { key: " ", preventDefault() {} });
  await flush();
  if (
    JSON.stringify(selected) !== JSON.stringify(["b", "a", "b"]) ||
    updates.length
  ) {
    throw new Error("Opening card details should not modify the task");
  }
  const editCard = currentCards[1];
  const edit = () =>
    editCard.fire("keydown", {
      key: "e",
      target: editCard,
      preventDefault() {},
    });
  const titleEdit =
    descendants(editCard, (node) => node.className === "card-title-input")[0];
  editCard.focus();
  edit();
  if (document.activeElement !== titleEdit || titleEdit.value !== "First") {
    throw new Error("e did not enter inline title editing");
  }
  titleEdit.value = "Discarded";
  titleEdit.fire("keydown", {
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  if (tasks[0].title !== "First" || document.activeElement !== editCard) {
    throw new Error(
      "Escape did not cancel title editing and return to the card",
    );
  }
  edit();
  titleEdit.value = "  ";
  titleEdit.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  if (titleEdit.hidden || updates.length) {
    throw new Error("Empty title was accepted");
  }
  titleEdit.value = "Renamed @tom";
  titleEdit.selectionStart = titleEdit.value.length;
  titleEdit.fire("input");
  if (
    !descendants(
      editCard,
      (node) =>
        node.className === "suggestion-option" &&
        node.textContent === "tomorrow",
    )
      .length
  ) {
    throw new Error("Inline edit did not suggest @tomorrow");
  }
  titleEdit.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  if (titleEdit.value !== "Renamed @tomorrow" || updates.length) {
    throw new Error("Enter did not complete @tomorrow before saving");
  }
  titleEdit.value = "Renamed @tomorrow #Extra";
  titleEdit.selectionStart = titleEdit.value.length;
  titleEdit.fire("input");
  titleEdit.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  titleEdit.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  await flush();
  if (
    tasks[0].title !== "Renamed" ||
    !updates.some(({ id, patch }) =>
      id === "a" && patch.title === "Renamed" &&
      patch.dueDay === BoardCore.resolveDateSuggestion("tomorrow").day &&
      patch.dueWithTime === null &&
      JSON.stringify(patch.tagIds) === JSON.stringify(["extra"]) &&
      !("timeEstimate" in patch)
    ) ||
    tasks[0].timeEstimate !== 5400000 ||
    document.activeElement?.dataset.taskId !== "a"
  ) {
    throw new Error(
      `Inline shortcuts did not preserve existing metadata: ${
        JSON.stringify(updates)
      }`,
    );
  }
  const revisedCard = descendants(
    app,
    (node) => node.tag === "article" && node.dataset.taskId === "a",
  )[0];
  revisedCard.focus();
  revisedCard.fire("keydown", {
    key: "e",
    target: revisedCard,
    preventDefault() {},
  });
  const revisedInput = descendants(
    revisedCard,
    (node) => node.className === "card-title-input",
  )[0];
  revisedInput.value = "Renamed @every friday";
  revisedInput.selectionStart = revisedInput.value.length;
  revisedInput.fire("input");
  revisedInput.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  if (
    revisedInput.hidden || tasks[0].title !== "Renamed" ||
    !errors.some((text) => text.includes("@ date suggestion"))
  ) {
    throw new Error("Unsupported edit date silently changed the task");
  }
  revisedInput.value = "Renamed @in 1 hour 45m";
  revisedInput.selectionStart = revisedInput.value.length;
  revisedInput.fire("input");
  revisedInput.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  revisedInput.fire("keydown", {
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  await flush();
  if (
    !updates.some(({ id, patch }) =>
      id === "a" &&
      patch.title === "Renamed" && patch.dueDay === null &&
      Math.abs(patch.dueWithTime - (Date.now() + 3600000)) < 60000 &&
      patch.timeEstimate === 2700000 && !("tagIds" in patch)
    ) ||
    JSON.stringify(tasks[0].tagIds) !== JSON.stringify(["extra"])
  ) {
    throw new Error(
      "Timed edit did not retain existing tags and replace the schedule",
    );
  }
  // Edits and completion happen in native details; the host hook refreshes the board.
  tasks.find((task) => task.id === "b").isDone = true;
  hooks.get("anyTaskUpdate")();
  await new Promise((resolve) => setTimeout(resolve, 220));
  await flush();
  if (descendants(app, (node) => node.tag === "article").length !== 1) {
    throw new Error(
      "Completion in native task details should hide the card from Workflow",
    );
  }
  tasks.push({
    id: "c",
    title: "In Doing",
    projectId: "p",
    tagIds: [tags.find((tag) => tag.title === "Doing").id],
    isDone: false,
  });
  hooks.get("anyTaskUpdate")();
  await new Promise((resolve) => setTimeout(resolve, 220));
  await flush();
  const taskCard = (id) =>
    descendants(
      app,
      (node) => node.tag === "article" && node.dataset.taskId === id,
    )[0];
  taskCard("a").focus();
  key(taskCard("a"), "l");
  if (document.activeElement !== taskCard("c")) {
    throw new Error("l did not cross empty lanes");
  }
  key(taskCard("c"), "h");
  if (document.activeElement !== taskCard("a")) {
    throw new Error("h did not return to Clarify");
  }
  const backlogId = tags.find((tag) => tag.title === "Backlog").id;
  key(taskCard("a"), "L", true);
  await flush();
  if (
    JSON.stringify(tasks[0].tagIds) !== JSON.stringify(["extra", backlogId]) ||
    document.activeElement !== taskCard("a")
  ) {
    throw new Error(
      "Shift+L did not move the card into the adjacent empty lane",
    );
  }
  key(taskCard("a"), "H", true);
  await flush();
  if (
    JSON.stringify(tasks[0].tagIds) !== JSON.stringify(["extra"]) ||
    document.activeElement !== taskCard("a")
  ) {
    throw new Error("Shift+H did not restore the card to Clarify");
  }
  key(taskCard("a"), "?");
  if (!descendants(app, (node) => node.className === "keyboard-help").length) {
    throw new Error("? did not reveal keyboard help");
  }
  key(document.activeElement, "Escape");
  if (descendants(app, (node) => node.className === "keyboard-help").length) {
    throw new Error("Escape did not hide keyboard help");
  }
  taskCard("c").focus();
  key(taskCard("c"), "d");
  await flush();
  if (
    !updates.some(({ id, patch }) => id === "c" && patch.isDone === true) ||
    taskCard("c")
  ) {
    throw new Error("d did not complete the focused card");
  }
  if (document.activeElement !== taskCard("a")) {
    throw new Error(
      "Completion lost keyboard focus instead of returning to a card",
    );
  }
  const form = () =>
    descendants(
      app,
      (node) => node.tag === "form" && node.className === "add-row",
    )[0];
  const titleInput = (parent) =>
    descendants(
      parent,
      (node) =>
        node.tag === "input" &&
        node.attributes["aria-label"] === "New task in Clarify",
    )[0];
  const type = (parent, text) => {
    const title = titleInput(parent);
    title.value = text;
    title.selectionStart = text.length;
    title.fire("input");
    return title;
  };
  const options = (parent) =>
    descendants(parent, (node) => node.className === "suggestion-option").map((
      node,
    ) => node.textContent);
  const submit = async (parent) => {
    parent.fire("submit", { preventDefault() {} });
    await flush();
  };
  const firstForm = form();
  if (
    descendants(firstForm, (node) =>
      node.tag === "button" &&
      ["Schedule", "# Tags", "Estimate"].includes(node.textContent)).length ||
    descendants(
      firstForm,
      (node) => node.type === "date" || node.type === "time",
    ).length
  ) {
    throw new Error("Inline add form still has extra controls");
  }
  const firstTitle = type(firstForm, "Write report #ex");
  if (JSON.stringify(options(firstForm)) !== JSON.stringify(["Extra"])) {
    throw new Error("# autocomplete did not suggest an existing non-lane tag");
  }
  firstTitle.fire("keydown", { key: "Enter", preventDefault() {} });
  if (firstTitle.value !== "Write report #Extra" || added.length) {
    throw new Error("Enter did not complete #tag in the title");
  }
  type(firstForm, "Write report #Extra @2026-10-22 14:30 1h");
  if (JSON.stringify(options(firstForm)) !== JSON.stringify(["1h", "1h 30m"])) {
    throw new Error("Estimate suggestions were hidden after a scheduled time");
  }
  type(firstForm, "Write report #Extra @2026-10-22 14:30 1h 30m");
  await submit(firstForm);
  if (document.activeElement !== titleInput(form())) {
    throw new Error("Quick add did not return focus to its lane input");
  }
  if (
    added.length !== 1 || added[0].title !== "Write report" ||
    added[0].projectId !== "p" ||
    JSON.stringify(added[0].tagIds) !== JSON.stringify(["extra"]) ||
    added[0].timeEstimate !== 5400000 || "dueDay" in added[0] ||
    !updates.some(({ id, patch }) =>
      id === "new-1" &&
      patch.dueWithTime === new Date(2026, 9, 22, 14, 30).getTime()
    )
  ) {
    throw new Error(
      `Keyboard entry did not persist its fields: ${
        JSON.stringify({ added, updates, errors })
      }`,
    );
  }
  const allDayForm = form();
  type(allDayForm, "All-day task @2026-10-23");
  await submit(allDayForm);
  if (
    added.length !== 2 || added[1].title !== "All-day task" ||
    added[1].dueDay !== "2026-10-23"
  ) {
    throw new Error("Typed all-day schedule was not saved");
  }
  const estimateForm = form();
  const estimateTitle = type(estimateForm, "Quick task 1h");
  if (
    JSON.stringify(options(estimateForm)) !== JSON.stringify(["1h", "1h 30m"])
  ) {
    throw new Error("Duration suggestions did not appear during typing");
  }
  estimateTitle.fire("keydown", { key: "ArrowDown", preventDefault() {} });
  estimateTitle.fire("keydown", { key: "Enter", preventDefault() {} });
  if (estimateTitle.value !== "Quick task 1h 30m" || added.length !== 2) {
    throw new Error(
      "Duration autocomplete submitted early or inserted the wrong value",
    );
  }
  await submit(estimateForm);
  if (
    added.length !== 3 || added[2].timeEstimate !== 5400000 ||
    added[2].title !== "Quick task"
  ) {
    throw new Error("Keyboard estimate was not saved");
  }
  const dateForm = form();
  const dateTitle = type(dateForm, "Review @tom");
  if (!options(dateForm).includes("tomorrow")) {
    throw new Error("@tom did not suggest tomorrow");
  }
  dateTitle.fire("keydown", { key: "Enter", preventDefault() {} });
  if (dateTitle.value !== "Review @tomorrow" || added.length !== 3) {
    throw new Error("Enter did not complete @tomorrow in the title");
  }
  await submit(dateForm);
  if (
    added.length !== 4 || added[3].title !== "Review" ||
    added[3].dueDay !== BoardCore.resolveDateSuggestion("tomorrow").day
  ) {
    throw new Error("@tomorrow did not save an all-day schedule");
  }
  const timedForm = form();
  const timedTitle = type(timedForm, "Follow up @in 1");
  if (!options(timedForm).includes("in 1 hour")) {
    throw new Error("Timed @ suggestions missing");
  }
  timedTitle.fire("keydown", { key: "Enter", preventDefault() {} });
  if (timedTitle.value !== "Follow up @in 1 hour") {
    throw new Error("Timed @ completion failed");
  }
  type(timedForm, "Follow up @in 1 hour 1h");
  if (JSON.stringify(options(timedForm)) !== JSON.stringify(["1h", "1h 30m"])) {
    throw new Error("Estimate suggestions were hidden after a relative date");
  }
  type(timedForm, "Follow up @in 1 hour");
  await submit(timedForm);
  if (
    added.length !== 5 || "dueDay" in added[4] ||
    !updates.some(({ id, patch }) =>
      id === "new-5" &&
      Math.abs(patch.dueWithTime - (Date.now() + 3600000)) < 60000
    )
  ) {
    throw new Error("Typed scheduled time was not saved");
  }
  const invalidForm = form();
  type(invalidForm, "Repeat @every friday");
  await submit(invalidForm);
  if (
    added.length !== 5 ||
    !errors.some((text) => text.includes("@ date suggestion"))
  ) {
    throw new Error("Unsupported @ syntax silently created a task");
  }
  const quotedTitle = type(invalidForm, "New #fo");
  if (!options(invalidForm).includes("Focus Time")) {
    throw new Error("Multiword tag suggestion missing");
  }
  quotedTitle.fire("keydown", { key: "Enter", preventDefault() {} });
  if (quotedTitle.value !== 'New #"Focus Time"') {
    throw new Error("Multiword tag was not quoted in input");
  }
  await submit(invalidForm);
  if (
    added.length !== 6 || added[5].title !== "New" ||
    JSON.stringify(added[5].tagIds) !== JSON.stringify(["focus"])
  ) {
    throw new Error("Selected multiword tag did not persist");
  }
  const cardBeforeRefresh = descendants(
    app,
    (node) => node.tag === "article" && node.dataset.taskId === "a",
  )[0];
  cardBeforeRefresh.focus();
  cardBeforeRefresh.fire("keydown", {
    key: "e",
    target: cardBeforeRefresh,
    preventDefault() {},
  });
  const draftInput = descendants(
    cardBeforeRefresh,
    (node) => node.className === "card-title-input",
  )[0];
  draftInput.value = "Unsaved draft";
  draftInput.setSelectionRange(5, 5);
  hooks.get("anyTaskUpdate")();
  await new Promise((resolve) => setTimeout(resolve, 220));
  await flush();
  if (
    document.activeElement?.className !== "card-title-input" ||
    document.activeElement.value !== "Unsaved draft" ||
    document.activeElement.selectionStart !== 5
  ) {
    throw new Error("Board refresh lost the inline edit draft or caret");
  }
  document.activeElement.fire("keydown", {
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  const menuCard = descendants(
    app,
    (node) => node.tag === "article" && node.dataset.taskId === "a",
  )[0];
  menuCard.fire("contextmenu", {
    preventDefault() {},
    clientX: 120,
    clientY: 200,
  });
  const menu = () =>
    descendants(app, (node) => node.className === "card-menu")[0];
  const menuItem = (label) =>
    descendants(menu(), (node) =>
      node.tag === "button" &&
      (node.attributes["aria-label"] === label ||
        descendants(node, (child) =>
          child.className === "card-menu-label" &&
          child.textContent === label).length))[0];
  if (
    !menu() || !menuItem("Open in List for focus…") ||
    !menuItem("Schedule today") || !menuItem("Schedule tomorrow") ||
    !menuItem("Move to top") || !menuItem("Move to bottom") ||
    !menuItem("Add subtask") || !menuItem("Open in List to duplicate…") ||
    !menuItem("Estimate") || !menuItem("Set priority in List…") ||
    !menuItem("Toggle tags") || !menuItem("Move to project") ||
    !menuItem("Delete task") ||
    document.activeElement !== menuItem("Schedule today")
  ) {
    throw new Error(
      "Right-click did not show a keyboard-focusable action menu",
    );
  }
  if (menu().style.top !== "200px") {
    throw new Error("Action menu did not open beside the pointer");
  }
  menuCard.fire("contextmenu", {
    preventDefault() {},
    clientX: 1000,
    clientY: 760,
  });
  if (menu().style.left !== "761px" || menu().style.top !== "660px") {
    throw new Error("Compact action menu overflowed the viewport");
  }
  menu().fire("keydown", { key: "ArrowDown", preventDefault() {} });
  if (document.activeElement !== menuItem("Schedule tomorrow")) {
    throw new Error("ArrowDown did not navigate the action menu");
  }
  menu().fire("keydown", { key: "Escape", preventDefault() {} });
  if (menu() || document.activeElement !== menuCard) {
    throw new Error(
      "Escape did not close the action menu and restore card focus",
    );
  }
  menuCard.fire("contextmenu", {
    preventDefault() {},
    clientX: 12,
    clientY: 12,
  });
  for (const listener of documentListeners.get("pointerdown") || []) {
    listener({ target: menuCard });
  }
  if (menu()) throw new Error("Clicking outside did not dismiss the menu");
  const editingInput =
    descendants(menuCard, (node) => node.className === "card-title-input")[0];
  menuCard.fire("contextmenu", {
    target: editingInput,
    preventDefault() {
      throw new Error("Native input context menu was stolen");
    },
  });
  if (menu()) throw new Error("Editing input opened the card action menu");
  menuCard.fire("keydown", { key: "m", target: menuCard, preventDefault() {} });
  if (!menu()) throw new Error("m did not reopen the menu");
  menu().fire("keydown", { key: "a", preventDefault() {} });
  if (!descendants(menu(), (node) => node.tag === "input").length) {
    throw new Error("The displayed A badge did not open Add subtask");
  }
  menu().fire("keydown", { key: "Escape", preventDefault() {} });
  menu().fire("keydown", { key: "t", preventDefault() {} });
  if (!menuItem("30m")) {
    throw new Error("The displayed T badge did not open Estimate");
  }
  menu().fire("keydown", { key: "Escape", preventDefault() {} });
  menu().fire("keydown", { key: "Backspace", preventDefault() {} });
  if (!menuItem("Delete task and subtasks")) {
    throw new Error(
      "Backspace must open the confirmation, not delete directly",
    );
  }
  menu().fire("keydown", { key: "Escape", preventDefault() {} });
  menu().fire("keydown", { key: "Escape", preventDefault() {} });
  menuCard.fire("contextmenu", { preventDefault() {}, clientX: 1, clientY: 1 });
  menuItem("Schedule tomorrow").fire("click", { stopPropagation() {} });
  await flush();
  if (
    !updates.some(({ id, patch }) =>
      id === "a" &&
      patch.dueDay === BoardCore.resolveDateSuggestion("tomorrow").day &&
      patch.dueWithTime === null
    ) || tasks[0].timeEstimate !== 2700000
  ) {
    throw new Error(
      "Scheduling from the menu did not replace the timed date safely",
    );
  }
  const latestCard = () =>
    descendants(
      app,
      (node) => node.tag === "article" && node.dataset.taskId === "a",
    )[0];
  latestCard().fire("contextmenu", {
    preventDefault() {},
    clientX: 1,
    clientY: 1,
  });
  menuItem("Schedule today").fire("click", { stopPropagation() {} });
  await flush();
  if (tasks[0].dueDay !== BoardCore.resolveDateSuggestion("today").day) {
    throw new Error("Schedule today did not apply");
  }
  const tagIdsBeforeOrder = JSON.stringify(tasks[0].tagIds);
  const updatesBeforeOrder = updates.length;
  latestCard().fire("contextmenu", {
    preventDefault() {},
    clientX: 1,
    clientY: 1,
  });
  menuItem("Move to bottom").fire("click", { stopPropagation() {} });
  await flush();
  const clarifyIds = () =>
    descendants(
      descendants(app, (node) =>
        node.className === "lane" &&
        node.attributes["aria-label"] === "Clarify")[0],
      (node) => node.tag === "article",
    ).map((node) => node.dataset.taskId);
  if (clarifyIds().at(-1) !== "a") {
    throw new Error("Move to bottom did not update board-local order");
  }
  latestCard().fire("contextmenu", {
    preventDefault() {},
    clientX: 1,
    clientY: 1,
  });
  menuItem("Move to top").fire("click", { stopPropagation() {} });
  await flush();
  if (
    clarifyIds()[0] !== "a" || updates.length !== updatesBeforeOrder ||
    JSON.stringify(tasks[0].tagIds) !== tagIdsBeforeOrder
  ) {
    throw new Error("Move to top changed task metadata or failed to reorder");
  }
  latestCard().fire("keydown", {
    key: "F10",
    shiftKey: true,
    target: latestCard(),
    preventDefault() {},
  });
  if (!menu()) throw new Error("Shift+F10 did not open the card menu");
  menu().fire("keydown", { key: "Escape", preventDefault() {} });
  const openTaskMenu = (id) => {
    const card = descendants(
      app,
      (node) => node.tag === "article" && node.dataset.taskId === id,
    )[0];
    card.fire("contextmenu", { preventDefault() {}, clientX: 90, clientY: 40 });
  };
  openTaskMenu("a");
  menuItem("Choose scheduled date").fire("click", { stopPropagation() {} });
  const dateInput = descendants(menu(), (node) => node.tag === "input")[0];
  dateInput.value = "2026-11-05";
  descendants(menu(), (node) => node.tag === "form")[0].fire("submit", {
    preventDefault() {},
  });
  await flush();
  if (tasks[0].dueDay !== "2026-11-05" || tasks[0].dueWithTime !== null) {
    throw new Error("Choose date did not update the native schedule");
  }
  openTaskMenu("a");
  menuItem("Estimate").fire("click", { stopPropagation() {} });
  if (!menuItem("30m") || !menuItem("Custom estimate")) {
    throw new Error("Estimate submenu missing");
  }
  menuItem("30m").fire("click", { stopPropagation() {} });
  await flush();
  if (tasks[0].timeEstimate !== 1800000) {
    throw new Error("Estimate submenu did not save 30m");
  }
  openTaskMenu("a");
  menuItem("Estimate").fire("click", { stopPropagation() {} });
  menuItem("Custom estimate").fire("click", { stopPropagation() {} });
  const customInput = descendants(menu(), (node) => node.tag === "input")[0];
  customInput.value = "invalid";
  descendants(menu(), (node) => node.tag === "form")[0].fire("submit", {
    preventDefault() {},
  });
  if (
    !menu() || tasks[0].timeEstimate !== 1800000 ||
    !descendants(menu(), (node) =>
      node.className === "card-menu-form-error" &&
      node.textContent.includes("Enter an estimate")).length
  ) {
    throw new Error(
      "Invalid estimate must leave the form open without updating",
    );
  }
  customInput.value = "45m";
  descendants(menu(), (node) => node.tag === "form")[0].fire("submit", {
    preventDefault() {},
  });
  await flush();
  if (tasks[0].timeEstimate !== 2700000) {
    throw new Error("Custom estimate failed or its submenu closed early");
  }
  openTaskMenu("a");
  menuItem("Toggle tags").fire("click", { stopPropagation() {} });
  if (!menuItem("Focus Time") || menuItem("Backlog")) {
    throw new Error("Tag submenu showed lane tags or omitted available tags");
  }
  menuItem("Focus Time").fire("click", { stopPropagation() {} });
  await flush();
  if (JSON.stringify(tasks[0].tagIds) !== JSON.stringify(["extra", "focus"])) {
    throw new Error("Toggling a tag discarded unrelated tags");
  }
  openTaskMenu("a");
  menuItem("Add subtask").fire("click", { stopPropagation() {} });
  const subtaskTitle = descendants(menu(), (node) => node.tag === "input")[0];
  subtaskTitle.value = "Child via menu";
  descendants(menu(), (node) => node.tag === "form")[0].fire("submit", {
    preventDefault() {},
  });
  await flush();
  const createdSubtask = tasks.find((entry) =>
    entry.title === "Child via menu"
  );
  if (
    createdSubtask?.parentId !== "a" || createdSubtask.projectId !== "p" ||
    selected.at(-1) !== createdSubtask.id ||
    descendants(app, (node) =>
      node.tag === "article" &&
      node.dataset.taskId === createdSubtask.id).length
  ) {
    throw new Error("Add subtask did not attach it to its parent safely");
  }
  openTaskMenu("new-6");
  menuItem("Move to project").fire("click", { stopPropagation() {} });
  menuItem("Other").fire("click", { stopPropagation() {} });
  await flush();
  if (
    tasks.find((entry) => entry.id === "new-6").projectId !== "q" ||
    descendants(app, (node) =>
      node.tag === "article" &&
      node.dataset.taskId === "new-6").length
  ) {
    throw new Error("Move to project did not update the native project");
  }
  openTaskMenu("new-5");
  if (
    !descendants(
      menuItem("Delete task"),
      (node) =>
        node.className === "card-menu-hint" && node.textContent === "Backspace",
    )
      .length
  ) {
    throw new Error("Delete action lost its keyboard hint");
  }
  menuItem("Delete task").fire("click", { stopPropagation() {} });
  if (
    !menuItem("Delete task and subtasks") ||
    !tasks.some((entry) => entry.id === "new-5")
  ) {
    throw new Error("Delete task lacked an explicit confirmation");
  }
  menuItem("Cancel").fire("click", { stopPropagation() {} });
  openTaskMenu("new-5");
  menuItem("Delete task").fire("click", { stopPropagation() {} });
  menuItem("Delete task and subtasks").fire("click", { stopPropagation() {} });
  await flush();
  if (tasks.some((entry) => entry.id === "new-5")) {
    throw new Error("Confirmed delete did not call the supported task API");
  }
  const parentComplete =
    descendants(latestCard(), (node) => node.className === "card-complete")[0];
  parentComplete.fire("click", { stopPropagation() {} });
  await flush();
  const finishCard = descendants(
    app,
    (node) => node.tag === "article" && node.dataset.taskId === "a",
  )[0];
  if (
    !tasks[0].isDone ||
    descendants(
      app,
      (node) => node.tag === "article" && node.dataset.taskId === "a",
    ).length ||
    !updates.some(({ id, patch }) => id === "a" && patch.isDone === true)
  ) {
    throw new Error(
      "Completion circle did not finish the parent task and hide its card",
    );
  }
  if (finishCard) throw new Error("Completed card remained visible");
  const remainingCard = descendants(
    app,
    (node) => node.tag === "article" && node.dataset.taskId === "new-1",
  )[0];
  const completeButton =
    descendants(remainingCard, (node) => node.className === "card-complete")[0];
  if (
    completeButton.textContent ||
    !completeButton.attributes["aria-label"].startsWith("Complete ")
  ) {
    throw new Error("Completion circle should not show a permanent checkmark");
  }
  completeButton.fire("click", { stopPropagation() {} });
  await flush();
  if (
    !tasks.find((task) => task.id === "new-1").isDone ||
    descendants(app, (node) =>
      node.tag === "article" &&
      node.dataset.taskId === "new-1").length
  ) {
    throw new Error("Visible complete button did not finish the task");
  }
  if (!hooks.has("anyTaskUpdate")) throw new Error("Task refresh hook missing");
  const boardKeydown = documentListeners.get("keydown");
  if (!boardKeydown?.length) throw new Error("Board exit shortcut missing");
  const chord = (target, key, modifiers) =>
    boardKeydown.forEach((fn) =>
      fn({
        key,
        ...modifiers,
        target,
        preventDefault() {},
      })
    );
  const field = { closest: () => ({ tag: "input" }) };
  chord(field, "V", { shiftKey: true });
  if (closed.length || values.has("view-p")) {
    throw new Error("Shift+V stole a capital V while typing");
  }
  chord(field, "k", { ctrlKey: true, altKey: true });
  await flush();
  if (values.get("view-p") !== "list" || closed.length !== 1) {
    throw new Error("Ctrl+Alt+K did not exit from an input");
  }
  values.delete("view-p");
  closed.length = 0;
  const boardSurface = document.querySelector(".board");
  boardSurface.focus();
  chord(boardSurface, "V", { shiftKey: true });
  await flush();
  if (values.get("view-p") !== "list" || closed.length !== 1) {
    throw new Error("Shift+V did not exit Kanban from card navigation");
  }
  values.delete("view-p");
  closed.length = 0;
  openTaskMenu("new-3");
  menuItem("Open in List for focus…").fire("click", { stopPropagation() {} });
  await flush();
  if (
    values.get("view-p") !== "list" || closed.length !== 1 ||
    selected.at(-1) !== "new-3"
  ) {
    throw new Error(
      "Host-only menu action did not take the task to native List",
    );
  }
});

Deno.test("board consumes exported typography, shape and focus tokens with separate coarse completion target", async () => {
  const css = await Deno.readTextFile(
    new URL("../src/style.css", import.meta.url),
  );
  for (
    const token of [
      "--font-size-md",
      "--card-border-radius",
      "--radius-md",
      "--focus-ring-width",
      "--focus-ring-offset",
      "--focus-ring-color",
      "--card-shadow",
    ]
  ) {
    if (!css.includes(`var(${token},`)) {
      throw new Error(`Board ignores exported token ${token}`);
    }
  }
  const coarse = css.slice(
    css.indexOf("@media (pointer: coarse)"),
    css.indexOf(".card-menu {"),
  );
  if (
    !/\.card-complete\s*\{[^}]*width: 44px;[^}]*height: 44px;/s.test(coarse) ||
    !/\.card-complete::before\s*\{[^}]*width: 16px;[^}]*height: 16px;/s.test(
      css,
    )
  ) {
    throw new Error(
      "Completion needs a large touch target, not a huge visible circle",
    );
  }
});

Deno.test("card action menu uses injected host theme tokens", async () => {
  const css = await Deno.readTextFile(
    new URL("../src/style.css", import.meta.url),
  );
  const menuCss = css.slice(
    css.indexOf(".card-menu {"),
    css.indexOf(".card-estimate {"),
  );
  for (
    const token of [
      "--card-bg",
      "--bg-lighter",
      "--divider-color",
      "--text-color",
      "--text-color-muted",
    ]
  ) {
    if (!menuCss.includes(`var(${token},`)) {
      throw new Error(`Menu does not follow host theme token ${token}`);
    }
  }
  for (
    const rule of [
      "width: min(255px, calc(100vw - 16px))",
      "height: 48px",
      "min-height: 48px",
      "width: 20px",
      "font-size: .875rem",
    ]
  ) {
    if (!menuCss.includes(rule)) {
      throw new Error(`Menu lost compact List-style proportion ${rule}`);
    }
  }
});

Deno.test("existing project boards migrate lanes without rewriting tasks", async () => {
  const source = await Deno.readTextFile(
    new URL("../src/board-ui.js", import.meta.url),
  );
  const app = new Node("main");
  Node.root = app;
  app.id = "app";
  const document = {
    createElement: (tag) => new Node(tag),
    createElementNS: (_namespace, tag) => new Node(tag),
    addEventListener() {},
    querySelectorAll: (selector) => app.querySelectorAll(selector),
    querySelector: (selector) => app.querySelector(selector),
    get activeElement() {
      return Node.activeElement;
    },
    getElementById: (id) =>
      descendants(app, (node) => node.id === id)[0] || null,
  };
  const values = new Map([
    ["template-p", "workflow"],
    [
      "workflow-lanes-p",
      JSON.stringify({
        lanes: [
          { tagId: "old-week", label: "My Week" },
          { tagId: "old-later" },
        ],
      }),
    ],
    ["workflow-lanes-q", JSON.stringify({ lanes: [{ tagId: "old-week" }] })],
  ]);
  const tags = [
    { id: "old-week", title: "This Week" },
    { id: "week", title: "This-Week" },
    { id: "old-later", title: "Maybe/Later" },
  ];
  const tasks = [
    {
      id: "a",
      title: "Legacy week",
      projectId: "p",
      tagIds: ["old-week", "extra"],
      isDone: false,
    },
    {
      id: "b",
      title: "Legacy later",
      projectId: "p",
      tagIds: ["old-later"],
      isDone: false,
    },
    {
      id: "c",
      title: "Other project",
      projectId: "q",
      tagIds: ["old-week"],
      isDone: false,
    },
  ];
  let updates = 0;
  const api = {
    Hooks: {
      ANY_TASK_UPDATE: "task",
      WORK_CONTEXT_CHANGE: "context",
      PERSISTED_DATA_CHANGED: "data",
    },
    registerHook() {},
    getActiveWorkContext: async () => ({
      id: "p",
      type: "PROJECT",
      title: "P",
    }),
    getAllProjects: async () => [
      { id: "p", title: "P", backlogTaskIds: [] },
      { id: "q", title: "Q", backlogTaskIds: [] },
    ],
    getAllTags: async () => [...tags],
    getTasks: async () => [...tasks],
    addTag: async ({ title }) => {
      const id = `new-${tags.length}`;
      tags.push({ id, title });
      return id;
    },
    updateTask: async (id, patch) => {
      updates++;
      Object.assign(tasks.find((task) => task.id === id), patch);
    },
    loadSyncedData: async (key) => values.get(key) || null,
    persistDataSynced: async (value, key) => values.set(key, value),
  };
  new Function("window", "document", "BoardCore", "console", source)(
    { PluginAPI: api, addEventListener() {} },
    document,
    BoardCore,
    { error() {} },
  );
  await flush();
  const later = tags.find((tag) => tag.title === "Maybe-Later");
  const pConfig = JSON.parse(values.get("workflow-lanes-p"));
  const qConfig = JSON.parse(values.get("workflow-lanes-q"));
  if (
    !later ||
    JSON.stringify(pConfig.lanes.map((lane) => lane.tagId)) !==
      JSON.stringify(["week", later.id]) ||
    JSON.stringify(qConfig.lanes.map((lane) => lane.tagId)) !==
      JSON.stringify(["week"]) ||
    JSON.stringify(pConfig.retiredTagIds) !==
      JSON.stringify(["old-week", "old-later"]) ||
    JSON.stringify(qConfig.retiredTagIds) !== JSON.stringify(["old-week"]) ||
    updates !== 0 || tasks[0].tagIds[0] !== "old-week"
  ) {
    throw new Error(
      "Saved boards were not retargeted without touching task tags",
    );
  }
  const lane = (name) =>
    descendants(
      app,
      (node) =>
        node.tag === "section" && node.className === "lane" &&
        node.attributes["aria-label"] === name,
    )[0];
  if (
    !lane("Clarify") || !lane("My Week") || !lane("Maybe/Later") ||
    descendants(lane("Clarify"), (node) => node.tag === "article").length !== 2
  ) {
    throw new Error(
      "Legacy tasks did not appear in Clarify for manual migration",
    );
  }
  lane("My Week").fire("drop", {
    preventDefault() {},
    dataTransfer: { getData: () => "a" },
  });
  await flush();
  if (
    updates !== 1 ||
    JSON.stringify(tasks[0].tagIds) !== JSON.stringify(["extra", "week"]) ||
    JSON.stringify(tasks[2].tagIds) !== JSON.stringify(["old-week"])
  ) {
    throw new Error("Moving a legacy card did not replace its old tag safely");
  }
  descendants(
    app,
    (node) => node.tag === "button" && node.textContent === "Configure lanes",
  )[0].click();
  const alias = descendants(app, (node) =>
    node.tag === "input" &&
    node.attributes["aria-label"] === "Display label for This-Week")[0];
  alias.value = "This week’s focus";
  alias.fire("change");
  await flush();
  if (
    JSON.stringify(JSON.parse(values.get("workflow-lanes-p")).retiredTagIds) !==
      JSON.stringify(["old-week", "old-later"])
  ) {
    throw new Error("Editing lane settings lost the legacy tag cleanup rule");
  }
});
