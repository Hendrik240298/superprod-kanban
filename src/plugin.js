// Host-side registration must survive unmounting the project-board iframe.
const viewKey = (id) => `view-${id}`;
const viewCache = new Map();
let generation = 0;

async function preferredView(id) {
  if (viewCache.has(id)) return viewCache.get(id);
  const value = await PluginAPI.loadSyncedData(viewKey(id));
  const view = value === "kanban" ? "kanban" : "list";
  viewCache.set(id, view);
  return view;
}

async function reconcile(ctx) {
  const token = ++generation;
  if (ctx?.type !== "PROJECT") {
    PluginAPI.closeWorkContextView();
    return;
  }
  try {
    const view = await preferredView(ctx.id);
    if (token !== generation) return;
    const current = await PluginAPI.getActiveWorkContext();
    if (
      token !== generation || current?.type !== "PROJECT" ||
      current.id !== ctx.id
    ) return;
    if (view === "kanban") PluginAPI.showInWorkContext();
    else PluginAPI.closeWorkContextView();
  } catch (error) {
    PluginAPI.log.err("Project Kanban: unable to load view preference", error);
    if (token === generation) PluginAPI.closeWorkContextView();
  }
}

function toggleView(ctx) {
  void (async () => {
    try {
      const next = (await preferredView(ctx.id)) === "kanban"
        ? "list"
        : "kanban";
      const current = await PluginAPI.getActiveWorkContext();
      if (current?.type !== "PROJECT" || current.id !== ctx.id) return;
      ++generation;
      viewCache.set(ctx.id, next);
      if (next === "kanban") PluginAPI.showInWorkContext();
      else PluginAPI.closeWorkContextView();
      await PluginAPI.persistDataSynced(next, viewKey(ctx.id));
    } catch (error) {
      viewCache.delete(ctx.id);
      PluginAPI.log.err(
        "Project Kanban: unable to save view preference",
        error,
      );
      PluginAPI.showSnack({
        msg: "Could not save the Kanban view preference",
        type: "ERROR",
      });
      void reconcile(ctx);
    }
  })();
}

PluginAPI.registerWorkContextHeaderButton({
  label: "List / Kanban",
  icon: "view_kanban",
  showFor: ["PROJECT"],
  onClick: toggleView,
});

PluginAPI.registerShortcut({
  id: "toggle-project-view",
  label: "Toggle project List / Kanban",
  onExec: () => {
    void PluginAPI.getActiveWorkContext().then((ctx) => {
      if (ctx?.type === "PROJECT") toggleView(ctx);
    }).catch((error) => {
      PluginAPI.log.err("Project Kanban: unable to toggle view", error);
    });
  },
});

PluginAPI.registerHook(PluginAPI.Hooks.WORK_CONTEXT_CHANGE, (ctx) => {
  void reconcile(ctx);
});
PluginAPI.registerHook(PluginAPI.Hooks.PERSISTED_DATA_CHANGED, () => {
  viewCache.clear();
  void PluginAPI.getActiveWorkContext().then(reconcile).catch((error) => {
    PluginAPI.log.err("Project Kanban: unable to reconcile synced view", error);
  });
});
PluginAPI.onReady(() => {
  void PluginAPI.getActiveWorkContext().then(reconcile).catch((error) => {
    PluginAPI.log.err("Project Kanban: unable to initialize", error);
  });
});
