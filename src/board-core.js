// Pure lane logic. The build inlines this into index.html; Deno imports it for tests.
const BoardCore = (() => {
  const fallback = { kind: "todo", label: "To Do" };
  const done = { kind: "done", label: "Done" };
  const WORKFLOW_TAGS = [
    "Backlog",
    "This Week",
    "Doing",
    "Waiting",
    "Scheduled",
    "Maybe/Later",
  ];

  function estimateLabel(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    if (ms < 60000) return "<1m";
    const minutes = Math.round(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return [hours && `${hours}h`, rest && `${rest}m`].filter(Boolean).join(" ");
  }

  function scheduledDate(task) {
    if (Number.isFinite(task.dueWithTime) && task.dueWithTime > 0) {
      const date = new Date(task.dueWithTime);
      return Number.isNaN(date.getTime()) ? null : { date, timed: true };
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.dueDay || "");
    if (!match) return null;
    const date = new Date(+match[1], +match[2] - 1, +match[3]);
    if (
      date.getFullYear() !== +match[1] ||
      date.getMonth() !== +match[2] - 1 ||
      date.getDate() !== +match[3]
    ) return null;
    return { date, timed: false };
  }

  function normalizeConfig(value, availableTags) {
    const tags = new Set(availableTags.map((tag) => tag.id));
    const lanes = [];
    const seen = new Set();
    for (const entry of Array.isArray(value?.lanes) ? value.lanes : []) {
      if (
        typeof entry?.tagId !== "string" ||
        entry.tagId === "TODAY" ||
        entry.tagId === "todo" ||
        entry.tagId === "done" ||
        !tags.has(entry.tagId) ||
        seen.has(entry.tagId)
      ) continue;
      seen.add(entry.tagId);
      lanes.push({
        kind: "tag",
        tagId: entry.tagId,
        label: typeof entry.label === "string"
          ? entry.label.trim().slice(0, 80)
          : "",
      });
    }
    return { lanes };
  }

  function columns(config, tags, template = "classic") {
    const tagById = new Map(tags.map((tag) => [tag.id, tag]));
    return [
      template === "workflow" ? { ...fallback, label: "Clarify" } : fallback,
      ...config.lanes.map((lane) => ({
        ...lane,
        label: lane.label || tagById.get(lane.tagId)?.title || "Tag",
      })),
      ...(template === "workflow" ? [] : [done]),
    ];
  }

  function laneFor(task, config, template = "classic") {
    if (task.isDone) return template === "workflow" ? null : "done";
    const ids = new Set(task.tagIds || []);
    return config.lanes.find((lane) => ids.has(lane.tagId))?.tagId || "todo";
  }

  function projectCards(tasks, projectId, config, template = "classic") {
    const grouped = new Map([
      ["todo", []],
      ...config.lanes.map((lane) => [lane.tagId, []]),
      ...(template === "workflow" ? [] : [["done", []]]),
    ]);
    for (const task of tasks) {
      if (task.projectId !== projectId) continue;
      const lane = laneFor(task, config, template);
      if (lane) grouped.get(lane).push(task);
    }
    return grouped;
  }

  function movePatch(task, target, config, template = "classic") {
    if (
      target !== "todo" && (target !== "done" || template === "workflow") &&
      !config.lanes.some((lane) => lane.tagId === target)
    ) {
      throw new Error("Unknown destination lane");
    }
    const laneIds = new Set(config.lanes.map((lane) => lane.tagId));
    const tagIds = [
      ...new Set((task.tagIds || []).filter((id) => !laneIds.has(id))),
    ];
    if (target !== "todo" && target !== "done") tagIds.push(target);
    return { tagIds, isDone: target === "done" };
  }

  function createFields(projectId, target, config, template = "classic") {
    if (!projectId) throw new Error("A project is required");
    const patch = movePatch({ tagIds: [] }, target, config, template);
    return { projectId, tagIds: patch.tagIds, isDone: patch.isDone };
  }

  function normalizeOrder(value, config, template = "classic") {
    const result = {};
    for (const { tagId, kind } of columns(config, [], template)) {
      const id = tagId || kind;
      const seen = new Set();
      result[id] = (Array.isArray(value?.[id]) ? value[id] : []).filter(
        (taskId) => {
          if (typeof taskId !== "string" || seen.has(taskId)) return false;
          seen.add(taskId);
          return true;
        },
      );
    }
    return result;
  }

  function orderCards(grouped, order) {
    const sorted = new Map();
    for (const [lane, cards] of grouped) {
      const byId = new Map(cards.map((task) => [task.id, task]));
      const ordered = [];
      for (const id of order[lane] || []) {
        const card = byId.get(id);
        if (card) {
          ordered.push(card);
          byId.delete(id);
        }
      }
      sorted.set(lane, [...ordered, ...byId.values()]);
    }
    return sorted;
  }

  // beforeId=null appends; IDs are board-local and never rewrite the app's taskIds.
  function placeTask(grouped, order, taskId, target, beforeId = null) {
    if (!grouped.has(target)) throw new Error("Unknown destination lane");
    const next = {};
    for (const [lane, cards] of grouped) {
      next[lane] = cards.map((card) => card.id).filter((id) => id !== taskId);
    }
    const position = beforeId ? next[target].indexOf(beforeId) : -1;
    next[target].splice(
      position < 0 ? next[target].length : position,
      0,
      taskId,
    );
    return { ...order, ...next };
  }

  return {
    WORKFLOW_TAGS,
    estimateLabel,
    scheduledDate,
    normalizeConfig,
    columns,
    laneFor,
    projectCards,
    movePatch,
    createFields,
    normalizeOrder,
    orderCards,
    placeTask,
  };
})();

export { BoardCore };
