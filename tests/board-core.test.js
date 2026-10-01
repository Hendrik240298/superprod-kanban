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
