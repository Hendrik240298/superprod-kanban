import { BoardCore } from "../src/board-core.js";

class Node {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = "";
    this.className = "";
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.offsetHeight = 100;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
  get lastChild() {
    return this.children.at(-1);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
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
  app.id = "app";
  const document = {
    createElement: (tag) => new Node(tag),
    getElementById: (id) =>
      descendants(app, (node) => node.id === id)[0] || null,
  };
  const values = new Map();
  const tags = [{ id: "progress", title: "In Progress" }];
  const tasks = [
    {
      id: "a",
      title: "First",
      projectId: "p",
      tagIds: [],
      isDone: false,
      dueDay: "2026-10-08",
      timeEstimate: 5400000,
    },
    {
      id: "b",
      title: "Second",
      projectId: "p",
      tagIds: [],
      isDone: false,
      dueWithTime: new Date(2026, 9, 9, 14, 30).getTime(),
    },
  ];
  const updates = [];
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
    getAllProjects: async () => [{ id: "p", backlogTaskIds: [] }],
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
    selectTask: async () => {},
    log: { err: () => {} },
  };
  new Function("window", "document", "BoardCore", source)(
    { PluginAPI: api },
    document,
    BoardCore,
  );
  await flush();
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
  const initialChips = descendants(
    app,
    (node) => node.className === "meta-chip",
  ).map((node) => node.textContent);
  if (
    !initialChips.some((text) =>
      text.includes("Scheduled") && text.includes("2026") && text.includes("8")
    ) ||
    !initialChips.some((text) => text.includes("Est. 1h 30m")) ||
    !initialChips.some((text) =>
      text.includes("Scheduled") && text.includes("30")
    )
  ) {
    throw new Error(
      `Missing schedule or estimate chips: ${JSON.stringify(initialChips)}`,
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
      ).length !== 3
  ) {
    throw new Error("Classic board did not render");
  }
  picker.value = "workflow";
  picker.fire("change");
  await flush();
  if (values.get("template-p") !== "workflow" || tags.length !== 7) {
    throw new Error("Workflow template did not initialize its six tag lanes");
  }
  const lanes = descendants(
    app,
    (node) => node.tag === "section" && node.className === "lane",
  );
  if (lanes.length !== 7 || lanes[0].attributes["aria-label"] !== "Clarify") {
    throw new Error("Expected seven workflow lanes starting with Clarify");
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
  const actions = descendants(app, (node) => node.tag === "details");
  if (actions.length !== 2) {
    throw new Error("Expected compact card action menus");
  }
  const complete = descendants(
    actions[0],
    (node) => node.tag === "button" && node.textContent === "Complete",
  )[0];
  complete.fire("click");
  await flush();
  if (updates.length !== 1 || updates[0].patch.isDone !== true) {
    throw new Error("Workflow completion did not update the task state");
  }
  if (descendants(app, (node) => node.tag === "article").length !== 1) {
    throw new Error("Completed task should be hidden from Workflow");
  }
  if (!hooks.has("anyTaskUpdate")) throw new Error("Task refresh hook missing");
});
