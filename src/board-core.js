// Pure lane logic. The build inlines this into index.html; Deno imports it for tests.
const BoardCore = (() => {
  const fallback = { kind: "todo", label: "To Do" };
  const done = { kind: "done", label: "Done" };

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

  function columns(config, tags) {
    const tagById = new Map(tags.map((tag) => [tag.id, tag]));
    return [
      fallback,
      ...config.lanes.map((lane) => ({
        ...lane,
        label: lane.label || tagById.get(lane.tagId)?.title || "Tag",
      })),
      done,
    ];
  }

  function laneFor(task, config) {
    if (task.isDone) return "done";
    const ids = new Set(task.tagIds || []);
    return config.lanes.find((lane) => ids.has(lane.tagId))?.tagId || "todo";
  }

  function projectCards(tasks, projectId, config) {
    const grouped = new Map([
      ["todo", []],
      ...config.lanes.map((lane) => [lane.tagId, []]),
      ["done", []],
    ]);
    for (const task of tasks) {
      if (task.projectId !== projectId) continue;
      grouped.get(laneFor(task, config)).push(task);
    }
    return grouped;
  }

  function movePatch(task, target, config) {
    if (
      target !== "todo" && target !== "done" &&
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

  function createFields(projectId, target, config) {
    if (!projectId) throw new Error("A project is required");
    const patch = movePatch({ tagIds: [] }, target, config);
    return { projectId, tagIds: patch.tagIds, isDone: patch.isDone };
  }

  return {
    normalizeConfig,
    columns,
    laneFor,
    projectCards,
    movePatch,
    createFields,
  };
})();

export { BoardCore };
