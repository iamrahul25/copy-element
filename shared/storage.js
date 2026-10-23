(() => {
  const CT = (globalThis.CopyThing = globalThis.CopyThing || {});
  if (CT.storage) return;

  const KEY = 'components';
  const OPTIONS_KEY = 'options';
  const area = () => chrome.storage.local;

  async function readAll() {
    const result = await area().get(KEY);
    return result[KEY] || {};
  }

  CT.storage = {
    KEY,

    async list() {
      return Object.values(await readAll()).sort((a, b) => b.createdAt - a.createdAt);
    },

    async get(id) {
      return (await readAll())[id] || null;
    },

    async save(component) {
      const all = await readAll();
      const id = component.id || CT.util.uid();
      all[id] = { ...component, id, createdAt: component.createdAt || Date.now() };
      await area().set({ [KEY]: all });
      return all[id];
    },

    async remove(id) {
      const all = await readAll();
      delete all[id];
      await area().set({ [KEY]: all });
    },

    async getOptions(defaults) {
      const result = await area().get(OPTIONS_KEY);
      return { ...defaults, ...(result[OPTIONS_KEY] || {}) };
    },

    async setOptions(options) {
      await area().set({ [OPTIONS_KEY]: options });
    },
  };
})();
