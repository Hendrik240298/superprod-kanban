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
  focus() {}
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
  app.id = "app";
  const document = {
    createElement: (tag) => new Node(tag),
    getElementById: (id) =>
      descendants(app, (node) => node.id === id)[0] || null,
  };
  const values = new Map();
  const tags = [{ id: "progress", title: "In Progress" }, {
    id: "extra",
    title: "Extra",
  }];
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
  const added = [];
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
    addTask: async (fields) => {
      added.push(fields);
      const id = `new-${added.length}`;
      tasks.push({ id, ...fields });
      return id;
    },
    selectTask: async () => {},
    log: { err: () => {} },
  };
  new Function("window", "document", "BoardCore", "console", source)(
    { PluginAPI: api },
    document,
    BoardCore,
    { error: (...args) => errors.push(args.join(" ")) },
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
      ).length !== 3
  ) {
    throw new Error("Classic board did not render");
  }
  picker.value = "workflow";
  picker.fire("change");
  await flush();
  if (values.get("template-p") !== "workflow" || tags.length !== 8) {
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
  const firstForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const titleInput = descendants(
    firstForm,
    (node) => node.tag === "input" && node.type === "text" && !node.className,
  )[0];
  titleInput.value = "Write report #ex";
  titleInput.selectionStart = titleInput.value.length;
  titleInput.fire("input");
  const extraOption = descendants(
    firstForm,
    (node) =>
      node.className === "suggestion-option" && node.textContent === "Extra",
  )[0];
  if (
    !extraOption ||
    descendants(
      firstForm,
      (node) =>
        node.className === "suggestion-option" && node.textContent === "Doing",
    ).length
  ) {
    throw new Error("# autocomplete did not suggest the matching non-lane tag");
  }
  titleInput.fire("keydown", { key: "Enter", preventDefault() {} });
  if (
    titleInput.value !== "Write report" ||
    !descendants(firstForm, (node) => node.className === "chosen-tag").length
  ) {
    throw new Error("# autocomplete did not add the tag and remove the token");
  }
  descendants(
    firstForm,
    (node) => node.tag === "button" && node.textContent === "Schedule",
  )[0].fire("click");
  const dateInput = descendants(firstForm, (node) => node.type === "date")[0];
  const timeInput = descendants(firstForm, (node) => node.type === "time")[0];
  dateInput.value = "2026-10-22";
  dateInput.fire("change");
  timeInput.value = "14:30";
  timeInput.fire("change");
  descendants(
    firstForm,
    (node) => node.tag === "button" && node.textContent === "Estimate",
  )[0].fire("click");
  const estimateInput = descendants(
    firstForm,
    (node) =>
      node.tag === "input" && node.className === "" &&
      node.attributes["aria-label"] === "Time estimate",
  )[0];
  estimateInput.value = "1h 30m";
  estimateInput.fire("input");
  firstForm.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 1 || added[0].projectId !== "p" ||
    added[0].title !== "Write report" ||
    JSON.stringify(added[0].tagIds) !== JSON.stringify(["extra"]) ||
    added[0].timeEstimate !== 5400000 || "dueWithTime" in added[0] ||
    !updates.some(({ id, patch }) =>
      id === "new-1" &&
      patch.dueWithTime === new Date(2026, 9, 22, 14, 30).getTime()
    )
  ) {
    throw new Error(
      `Timed task was not created correctly: ${
        JSON.stringify({ added, updates })
      }`,
    );
  }
  const nextForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const nextTitle = descendants(
    nextForm,
    (node) =>
      node.tag === "input" &&
      node.attributes["aria-label"] === "New task in Clarify",
  )[0];
  nextTitle.value = "All-day task";
  nextTitle.fire("input");
  descendants(
    nextForm,
    (node) => node.tag === "button" && node.textContent === "Schedule",
  )[0].fire("click");
  const nextDate = descendants(nextForm, (node) => node.type === "date")[0];
  nextDate.value = "2026-10-23";
  nextDate.fire("change");
  nextForm.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 2 || added[1].dueDay !== "2026-10-23" ||
    "dueWithTime" in added[1]
  ) {
    throw new Error("All-day schedule was not passed directly to addTask");
  }
  const lastForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const lastTitle = descendants(
    lastForm,
    (node) => node.attributes["aria-label"] === "New task in Clarify",
  )[0];
  lastTitle.value = "Quick task";
  lastTitle.fire("input");
  descendants(
    lastForm,
    (node) => node.tag === "button" && node.textContent === "# Tags",
  )[0].fire("click");
  const tagSearch =
    descendants(lastForm, (node) => node.className === "tag-search")[0];
  tagSearch.value = "extra";
  tagSearch.fire("input");
  tagSearch.fire("keydown", { key: "Enter", preventDefault() {} });
  if (
    added.length !== 2 ||
    !descendants(lastForm, (node) => node.className === "chosen-tag").length
  ) {
    throw new Error(
      "Tag search Enter either submitted early or failed to select a tag",
    );
  }
  descendants(
    lastForm,
    (node) => node.tag === "button" && node.textContent === "Estimate",
  )[0].fire("click");
  descendants(
    lastForm,
    (node) => node.tag === "button" && node.textContent === "2h",
  )[0].fire("click");
  descendants(
    lastForm,
    (node) => node.tag === "button" && node.textContent === "Schedule",
  )[0].fire("click");
  const invalidTime = descendants(lastForm, (node) => node.type === "time")[0];
  invalidTime.value = "14:30";
  invalidTime.fire("change");
  lastForm.fire("submit", { preventDefault() {} });
  if (
    added.length !== 2 ||
    !errors.some((error) => error.includes("Choose a scheduled date"))
  ) {
    throw new Error("A time without a date was not rejected visibly");
  }
  const lastDate = descendants(lastForm, (node) => node.type === "date")[0];
  lastDate.value = "2026-10-24";
  lastDate.fire("change");
  lastForm.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 3 || added[2].timeEstimate !== 7200000 ||
    !added[2].tagIds.includes("extra")
  ) {
    throw new Error("Tag search or estimate preset was not applied");
  }
  const dateForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const dateTitle = descendants(
    dateForm,
    (node) => node.attributes["aria-label"] === "New task in Clarify",
  )[0];
  dateTitle.value = "Review @tom";
  dateTitle.selectionStart = dateTitle.value.length;
  dateTitle.fire("input");
  const tomorrow = descendants(
    dateForm,
    (node) =>
      node.className === "suggestion-option" &&
      node.textContent === "tomorrow",
  )[0];
  if (!tomorrow) throw new Error("@tom did not suggest tomorrow");
  dateTitle.fire("keydown", { key: "Enter", preventDefault() {} });
  const expectedTomorrow = BoardCore.resolveDateSuggestion("tomorrow").day;
  if (
    dateTitle.value !== "Review" ||
    descendants(dateForm, (node) => node.type === "date")[0].value !==
      expectedTomorrow
  ) {
    throw new Error(
      "Selecting @tomorrow did not strip the token and set the date",
    );
  }
  dateForm.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 4 || added[3].title !== "Review" ||
    added[3].dueDay !== expectedTomorrow
  ) {
    throw new Error("@tomorrow did not persist an all-day schedule");
  }
  const timeForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const timeTitle = descendants(
    timeForm,
    (node) => node.attributes["aria-label"] === "New task in Clarify",
  )[0];
  timeTitle.value = "Follow up @in 1";
  timeTitle.selectionStart = timeTitle.value.length;
  timeTitle.fire("input");
  const hour = descendants(
    timeForm,
    (node) =>
      node.className === "suggestion-option" &&
      node.textContent === "in 1 hour",
  )[0];
  if (!hour) throw new Error("@in 1 did not suggest a timed schedule");
  hour.fire("click");
  if (
    timeTitle.value !== "Follow up" ||
    !descendants(timeForm, (node) => node.type === "time")[0].value
  ) {
    throw new Error("Selecting a timed @ suggestion did not set the time");
  }
  timeForm.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 5 || "dueDay" in added[4] ||
    !updates.some(({ id, patch }) =>
      id === "new-5" &&
      Math.abs(patch.dueWithTime - (Date.now() + 3600000)) < 60000
    )
  ) {
    throw new Error("Timed @ suggestion did not persist a timed schedule");
  }
  const exactForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const exactTitle = descendants(
    exactForm,
    (node) => node.attributes["aria-label"] === "New task in Clarify",
  )[0];
  exactTitle.value = "Write @today";
  exactTitle.selectionStart = exactTitle.value.length;
  exactTitle.fire("input");
  exactForm.fire("submit", { preventDefault() {} });
  await flush();
  if (
    added.length !== 6 || added[5].title !== "Write" ||
    added[5].dueDay !== BoardCore.resolveDateSuggestion("today").day
  ) {
    throw new Error("Submitting an exact @ date did not apply it");
  }
  const unsupportedForm = descendants(
    app,
    (node) => node.tag === "form" && node.className === "add-row",
  )[0];
  const unsupportedTitle = descendants(
    unsupportedForm,
    (node) => node.attributes["aria-label"] === "New task in Clarify",
  )[0];
  unsupportedTitle.value = "Repeat @every friday";
  unsupportedTitle.selectionStart = unsupportedTitle.value.length;
  unsupportedTitle.fire("input");
  unsupportedForm.fire("submit", { preventDefault() {} });
  if (
    added.length !== 6 ||
    !errors.some((text) =>
      text.includes("Other @ expressions are not supported")
    )
  ) {
    throw new Error("Unsupported @ text was silently created as a task");
  }
  if (!hooks.has("anyTaskUpdate")) throw new Error("Task refresh hook missing");
});
