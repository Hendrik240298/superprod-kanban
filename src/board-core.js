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
  const DATE_SUGGESTIONS = [
    "today",
    "tomorrow",
    "tonight",
    "next week",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "in 1 hour",
    "in 2 hours",
    "at 9am",
    "at 3pm",
  ];

  function dateSuggestions(query) {
    const text = query.trim().toLowerCase();
    const matches = DATE_SUGGESTIONS.filter((label) => label.includes(text));
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      try {
        parseSchedule(text, "");
        matches.unshift(text);
      } catch { /* Invalid dates are not suggestions. */ }
    }
    return matches.slice(0, 10);
  }

  function resolveDateSuggestion(label, now = new Date()) {
    const next = new Date(now);
    let time = "";
    if (label === "today") {
      // Use the current calendar date.
    } else if (label === "tomorrow") {
      next.setDate(next.getDate() + 1);
    } else if (label === "next week") {
      next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
    } else if (
      label === "tonight" || label === "at 9am" || label === "at 3pm"
    ) {
      const hour = label === "tonight" ? 20 : label === "at 9am" ? 9 : 15;
      next.setHours(hour, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      time = `${String(hour).padStart(2, "0")}:00`;
    } else if (label === "in 1 hour" || label === "in 2 hours") {
      next.setTime(next.getTime() + (label === "in 1 hour" ? 1 : 2) * 3600000);
      time = `${String(next.getHours()).padStart(2, "0")}:${
        String(next.getMinutes()).padStart(2, "0")
      }`;
    } else if (DATE_SUGGESTIONS.includes(label)) {
      const weekday = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ].indexOf(label);
      next.setDate(next.getDate() + (weekday - next.getDay() + 7) % 7);
    } else {
      parseSchedule(label, "");
      return { day: label, time: "" };
    }
    const day = `${next.getFullYear()}-${
      String(next.getMonth() + 1).padStart(2, "0")
    }-${String(next.getDate()).padStart(2, "0")}`;
    return { day, time };
  }

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

  function parseEstimate(value) {
    const text = value.trim().toLowerCase();
    if (!text) return null;
    const match = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text);
    if (!match || (!match[1] && !match[2])) {
      throw new Error("Enter an estimate such as 45m or 1h 30m.");
    }
    const minutes = Number((match[1] || "0").replace(",", ".")) * 60 +
      Number(match[2] || "0");
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) {
      throw new Error("Estimate must be between 1 minute and 7 days.");
    }
    return Math.round(minutes * 60000);
  }

  function parseSchedule(day, time) {
    if (!day && !time) return {};
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) throw new Error("Choose a scheduled date first.");
    const year = +match[1];
    const month = +match[2] - 1;
    const date = +match[3];
    const clock = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
    if (time && (!clock || +clock[1] > 23 || +clock[2] > 59)) {
      throw new Error("Choose a valid scheduled time.");
    }
    const at = new Date(
      year,
      month,
      date,
      clock ? +clock[1] : 0,
      clock ? +clock[2] : 0,
    );
    if (
      at.getFullYear() !== year || at.getMonth() !== month ||
      at.getDate() !== date ||
      (clock && (at.getHours() !== +clock[1] || at.getMinutes() !== +clock[2]))
    ) {
      throw new Error("Choose a valid scheduled date and time.");
    }
    return clock ? { dueWithTime: at.getTime() } : { dueDay: day };
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
    dateSuggestions,
    resolveDateSuggestion,
    estimateLabel,
    scheduledDate,
    parseEstimate,
    parseSchedule,
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
