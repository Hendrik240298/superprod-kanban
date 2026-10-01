import { BoardCore } from "../src/board-core.js";

const equal = (actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const tags = [{ id: "p", title: "Progress" }, { id: "r", title: "Review" }];
const config = BoardCore.normalizeConfig({
  lanes: [{ tagId: "p" }, { tagId: "r", label: "Check" }],
}, tags);

Deno.test("scheduled date and time estimate metadata uses task API fields", () => {
  equal(BoardCore.estimateLabel(0), null);
  equal(BoardCore.estimateLabel(30000), "<1m");
  equal(BoardCore.estimateLabel(5400000), "1h 30m");
  equal(BoardCore.estimateLabel(7200000), "2h");
  equal(BoardCore.scheduledDate({ dueDay: "2026-10-08" }).timed, false);
  equal(BoardCore.scheduledDate({ dueDay: "2026-02-30" }), null);
  equal(
    BoardCore.scheduledDate({ dueWithTime: 100000, dueDay: "2026-10-08" })
      .timed,
    true,
  );
  equal(BoardCore.scheduledDate({}), null);
});

Deno.test("inline creation parses estimates and all-day or timed schedules", () => {
  equal(BoardCore.parseEstimate(""), null);
  equal(BoardCore.parseEstimate("1h 30m"), 5400000);
  equal(BoardCore.parseEstimate("45m"), 2700000);
  equal(BoardCore.parseEstimate("1.5h"), 5400000);
  equal(BoardCore.parseSchedule("", ""), {});
  equal(BoardCore.parseSchedule("2026-10-22", ""), { dueDay: "2026-10-22" });
  equal(BoardCore.parseSchedule("2026-10-22", "14:30"), {
    dueWithTime: new Date(2026, 9, 22, 14, 30).getTime(),
  });
  for (
    const [day, time] of [["", "14:30"], ["2026-02-30", ""], [
      "2026-10-22",
      "25:00",
    ]]
  ) {
    let rejected = false;
    try {
      BoardCore.parseSchedule(day, time);
    } catch {
      rejected = true;
    }
    equal(rejected, true);
  }
  for (const invalid of ["0m", "soon", "8d"]) {
    let rejected = false;
    try {
      BoardCore.parseEstimate(invalid);
    } catch {
      rejected = true;
    }
    equal(rejected, true);
  }
});

Deno.test("@ suggestions resolve common dates and times without guessing other text", () => {
  const now = new Date(2026, 9, 1, 10, 30);
  equal(BoardCore.dateSuggestions("tom"), ["tomorrow"]);
  equal(BoardCore.dateSuggestions("next w"), ["next week"]);
  equal(BoardCore.dateSuggestions("in 1"), ["in 1 hour"]);
  equal(BoardCore.dateSuggestions("2026-10-22"), ["2026-10-22"]);
  equal(BoardCore.dateSuggestions("2026-02-30"), []);
  equal(BoardCore.resolveDateSuggestion("today", now), {
    day: "2026-10-01",
    time: "",
  });
  equal(BoardCore.resolveDateSuggestion("tomorrow", now), {
    day: "2026-10-02",
    time: "",
  });
  equal(BoardCore.resolveDateSuggestion("next week", now), {
    day: "2026-10-05",
    time: "",
  });
  equal(BoardCore.resolveDateSuggestion("monday", now), {
    day: "2026-10-05",
    time: "",
  });
  equal(BoardCore.resolveDateSuggestion("in 1 hour", now), {
    day: "2026-10-01",
    time: "11:30",
  });
  equal(BoardCore.resolveDateSuggestion("at 9am", now), {
    day: "2026-10-02",
    time: "09:00",
  });
  equal(BoardCore.resolveDateSuggestion("2026-10-22", now), {
    day: "2026-10-22",
    time: "",
  });
});

Deno.test("columns use tag names, local aliases and the two special lanes", () => {
  equal(BoardCore.columns(config, tags).map(({ label }) => label), [
    "To Do",
    "Progress",
    "Check",
    "Done",
  ]);
});

Deno.test("membership is project-scoped and exclusive even with conflicting tags", () => {
  const tasks = [
    { id: "first", projectId: "a", tagIds: ["r", "p"], isDone: false },
    { id: "other", projectId: "b", tagIds: ["p"], isDone: false },
    { id: "orphan", projectId: "a", tagIds: ["old"], isDone: false },
    { id: "completed", projectId: "a", tagIds: ["p"], isDone: true },
  ];
  const grouped = BoardCore.projectCards(tasks, "a", config);
  equal(
    [...grouped].map(([lane, values]) => [lane, values.map((task) => task.id)]),
    [
      ["todo", ["orphan"]],
      ["p", ["first"]],
      ["r", []],
      ["done", ["completed"]],
    ],
  );
});

Deno.test("moving removes lane tags only and keeps unrelated tags", () => {
  const task = { tagIds: ["p", "unrelated", "r"], isDone: false };
  equal(BoardCore.movePatch(task, "r", config), {
    tagIds: ["unrelated", "r"],
    isDone: false,
  });
  equal(BoardCore.movePatch(task, "done", config), {
    tagIds: ["unrelated"],
    isDone: true,
  });
  equal(BoardCore.movePatch({ ...task, isDone: true }, "todo", config), {
    tagIds: ["unrelated"],
    isDone: false,
  });
});

Deno.test("removing a lane does not delete a task or its old tag", () => {
  const withoutReview = BoardCore.normalizeConfig(
    { lanes: [{ tagId: "p" }] },
    tags,
  );
  const task = { id: "x", projectId: "a", tagIds: ["r"], isDone: false };
  equal(BoardCore.laneFor(task, withoutReview), "todo");
  equal(BoardCore.movePatch(task, "p", withoutReview), {
    tagIds: ["r", "p"],
    isDone: false,
  });
});

Deno.test("config rejects missing, duplicate and virtual tags", () => {
  equal(
    BoardCore.normalizeConfig({
      lanes: [
        { tagId: "p", label: " Mine " },
        { tagId: "p" },
        { tagId: "deleted" },
        { tagId: "TODAY" },
      ],
    }, tags),
    { lanes: [{ kind: "tag", tagId: "p", label: "Mine" }] },
  );
});

Deno.test("creating in any lane always assigns project and uses completion rather than a Done tag", () => {
  equal(BoardCore.createFields("a", "p", config), {
    projectId: "a",
    tagIds: ["p"],
    isDone: false,
  });
  equal(BoardCore.createFields("a", "done", config), {
    projectId: "a",
    tagIds: [],
    isDone: true,
  });
  equal(BoardCore.createFields("a", "todo", config), {
    projectId: "a",
    tagIds: [],
    isDone: false,
  });
});

Deno.test("workflow template has Clarify and six tag lanes, but no Done", () => {
  const workflowTags = BoardCore.WORKFLOW_TAGS.map((title, i) => ({
    id: `w${i}`,
    title,
  }));
  const workflow = BoardCore.normalizeConfig({
    lanes: workflowTags.map((tag) => ({ tagId: tag.id })),
  }, workflowTags);
  equal(
    BoardCore.columns(workflow, workflowTags, "workflow").map((lane) =>
      lane.label
    ),
    [
      "Clarify",
      ...BoardCore.WORKFLOW_TAGS,
    ],
  );
  const cards = BoardCore.projectCards(
    [
      { id: "a", projectId: "p", tagIds: [], isDone: false },
      { id: "b", projectId: "p", tagIds: ["w0"], isDone: false },
      { id: "c", projectId: "p", tagIds: ["w0"], isDone: true },
    ],
    "p",
    workflow,
    "workflow",
  );
  equal(cards.get("todo").map((task) => task.id), ["a"]);
  equal(cards.get("w0").map((task) => task.id), ["b"]);
  equal(cards.has("done"), false);
  let rejected = false;
  try {
    BoardCore.movePatch({ tagIds: [] }, "done", workflow, "workflow");
  } catch {
    rejected = true;
  }
  equal(rejected, true);
});

Deno.test("lane-local order is applied without changing task records or other lanes", () => {
  const cards = BoardCore.projectCards(
    [
      { id: "a", projectId: "p", tagIds: [], isDone: false },
      { id: "b", projectId: "p", tagIds: [], isDone: false },
      { id: "c", projectId: "p", tagIds: ["p"], isDone: false },
    ],
    "p",
    config,
  );
  const order = BoardCore.normalizeOrder(
    { todo: ["b", "a", "b", "deleted"] },
    config,
  );
  equal(BoardCore.orderCards(cards, order).get("todo").map((task) => task.id), [
    "b",
    "a",
  ]);
  const reordered = BoardCore.placeTask(cards, order, "b", "todo", "a");
  equal(reordered.todo, ["b", "a"]);
  equal(reordered.p, ["c"]);
  const next = BoardCore.placeTask(cards, order, "a", "p", null);
  equal(next.todo, ["b"]);
  equal(next.p, ["c", "a"]);
  equal(cards.get("todo").map((task) => task.id), ["a", "b"]);
});
