/* A stand-in for Tauri's IPC, injected before the page loads so `isTauri()` is true and the
   real @tauri-apps/api code paths run. Commands are routed to in-page fakes; every invoke is
   recorded in `window.__calls`. Knobs a test may set before load (see helpers.js):
     __voices        the list `speech_voices` returns
     __voicesFail    `speech_voices` rejects
     __speechSilent  `speech_speak` succeeds but never reports a boundary or an end (a voice that failed quietly)
     __speechFail    `speech_speak` rejects
     __msPerWord     how fast the fake voice reads (default 30 ms a word)
     __themes        the names `list_themes` returns
     __doc           the document `open_document` returns
   `window.__emit(event, payload)` fires a Tauri event at the page's listeners. */
(() => {
  const calls = [];
  const listeners = {};
  let cbSeq = 0, evSeq = 0, timers = [];
  const defaults = {
    __voices: [
      { id: "com.apple.voice.premium.en-US.Ava", name: "Ava", lang: "en-US", quality: "premium" },
      { id: "com.apple.voice.compact.en-US.Samantha", name: "Samantha", lang: "en-US", quality: "default" },
    ],
    __msPerWord: 30,
    __themes: [],
    __doc: null,
  };
  for (const [k, v] of Object.entries(defaults)) if (!(k in window)) window[k] = v;

  function emit(event, payload) {
    for (const id of Object.values(listeners[event] || {})) window[`_${id}`]?.({ event, id: 0, payload });
  }
  function stopSpeech() { for (const t of timers) clearTimeout(t); timers = [] }

  const routes = {
    "plugin:event|listen": ({ event, handler }) => { const id = ++evSeq; (listeners[event] ||= {})[id] = handler; return id },
    "plugin:event|unlisten": ({ event, eventId }) => { if (listeners[event]) delete listeners[event][eventId] },
    speech_voices: () => { if (window.__voicesFail) throw "speech_voices failed"; return window.__voices },
    speech_speak: ({ id, text }) => {
      stopSpeech();
      if (window.__speechFail) throw "The voice could not start.";
      if (window.__speechSilent) return null;
      const words = [...text.matchAll(/\S+/g)];
      words.forEach((m, k) => timers.push(setTimeout(() => emit("speech:boundary", { id, charIndex: m.index }), k * window.__msPerWord)));
      timers.push(setTimeout(() => emit("speech:end", { id }), words.length * window.__msPerWord));
      return null;
    },
    speech_stop: () => { stopSpeech(); return null },
    "plugin:window|set_theme": () => null,
    list_themes: () => window.__themes,
    open_document: () => window.__doc,
    read_theme: () => ":root { --bg: #111; }",
    save_theme: ({ name }) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    save_override: () => null,
    remove_theme: () => null,
    add_theme: () => null,
  };

  window.isTauri = true;
  window.__calls = calls;
  window.__emit = emit;
  window.__TAURI_INTERNALS__ = {
    invoke(cmd, args = {}) {
      calls.push({ cmd, args });
      const route = routes[cmd];
      if (!route) return Promise.reject(`no such command: ${cmd}`);
      try { return Promise.resolve(route(args)) } catch (e) { return Promise.reject(e) }
    },
    transformCallback(cb, once) {
      const id = ++cbSeq;
      window[`_${id}`] = r => { if (once) delete window[`_${id}`]; cb(r) };
      return id;
    },
    unregisterCallback(id) { delete window[`_${id}`] },
    convertFileSrc: (path, protocol = "asset") => `${protocol}://localhost/${path}`,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event, id) { if (listeners[event]) delete listeners[event][id] } };
})();
