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
  removeAttribute(key) {
    delete this.attributes[key];
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
  const documentListeners = new Map();
  const document = {
    createElement: (tag) => new Node(tag),
    addEventListener: (key, fn) => documentListeners.set(key, fn),
    getElementById: (id) =>
      descendants(app, (node) => node.id === id)[0] || null,
  };
  const values = new Map();
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
    selectTask: async (id) => {
      selected.push(id);
    },
    closeWorkContextView: () => closed.push(true),
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
  if (values.get("template-p") !== "workflow" || tags.length !== 9) {
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
  const currentCards = descendants(app, (node) => node.tag === "article");
  if (
    currentCards.length !== 2 ||
    currentCards.some((card) =>
      card.attributes.role !== "button" || card.tabIndex !== 0 ||
      descendants(
        card,
        (node) => node.tag === "details" || node.tag === "button",
      ).length
    )
  ) {
    throw new Error(
      "Cards should open task details without extra action menus",
    );
  }
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
  if (!hooks.has("anyTaskUpdate")) throw new Error("Task refresh hook missing");
  const boardKeydown = documentListeners.get("keydown");
  if (!boardKeydown) throw new Error("Board exit shortcut missing");
  const chord = (target) =>
    boardKeydown({
      key: "k",
      ctrlKey: true,
      altKey: true,
      target,
      preventDefault() {},
    });
  chord({ closest: () => ({ tag: "input" }) });
  if (closed.length || values.has("view-p")) {
    throw new Error("Board shortcut stole a key while typing");
  }
  chord({ closest: () => null });
  await flush();
  if (values.get("view-p") !== "list" || closed.length !== 1) {
    throw new Error("Board shortcut did not restore the project list");
  }
});
