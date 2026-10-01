const equal = (a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

Deno.test("view toggle persists per project and restores List on project switch", async () => {
  const source = await Deno.readTextFile(
    new URL("../src/plugin.js", import.meta.url),
  );
  const callbacks = new Map();
  const stored = new Map();
  const shown = [];
  let button;
  let active = { id: "a", type: "PROJECT" };
  const api = {
    Hooks: {
      WORK_CONTEXT_CHANGE: "workContextChange",
      PERSISTED_DATA_CHANGED: "persistedDataChanged",
    },
    registerWorkContextHeaderButton: (cfg) => {
      button = cfg;
    },
    registerHook: (name, handler) => callbacks.set(name, handler),
    onReady: (handler) => handler(),
    getActiveWorkContext: async () => active,
    loadSyncedData: async (key) => stored.get(key) || null,
    persistDataSynced: async (value, key) => {
      stored.set(key, value);
    },
    showInWorkContext: () => shown.push(`board:${active.id}`),
    closeWorkContextView: () => shown.push(`list:${active?.id}`),
    showSnack: () => {
      throw new Error("Unexpected failure");
    },
    log: {
      err: (message) => {
        throw new Error(message);
      },
    },
  };
  new Function("PluginAPI", source)(api);
  const flush = async () => {
    for (let i = 0; i < 6; ++i) await Promise.resolve();
  };
  await flush();
  equal(button.showFor, ["PROJECT"]);
  button.onClick(active);
  await flush();
  equal(stored.get("view-a"), "kanban");
  active = { id: "b", type: "PROJECT" };
  callbacks.get("workContextChange")(active);
  await flush();
  equal(shown.at(-1), "list:b");
  active = { id: "a", type: "PROJECT" };
  callbacks.get("workContextChange")(active);
  await flush();
  equal(shown.at(-1), "board:a");
  button.onClick(active);
  await flush();
  equal(stored.get("view-a"), "list");
  equal(shown.at(-1), "list:a");
});
