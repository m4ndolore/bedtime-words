/* Bedtime words store: everything a family sets up lives in this browser under one key.
 * The built-in pool comes from /pool.json; family-written affirmations get "o-" ids so they
 * never collide with the pool's numeric ids. Every storage call is guarded: when storage is
 * blocked, the page still works for the visit and `persistent` turns false. `simple` lists the
 * pool ids a family switched to the simpler wording; each choice lasts until they switch back.
 * Affirmations added from other families are kept as own copies (with `community` set to the
 * shared id) so they work offline; `hearted` remembers which shared ones this device hearted.
 */
(function (root) {
  'use strict';

  const KEY = 'bedtime-words-v1';
  const VERSION = 1;
  const MAX_TEXT = 160;
  const OWN = { name: 'Our Own', description: 'Affirmations we wrote' };
  const DEFAULT_ROTATION = [1, 2, 3];
  const DEFAULT_PREFS = { hide: true, shuffle: false, sound: true, music: true, night: null };

  function createStore({ storage, fetchPool, uuid }) {
    let pool = null;
    let persistent = true;
    let data = null;

    function defaults() {
      return {
        version: VERSION,
        rotation: DEFAULT_ROTATION.slice(),
        own: [],
        simple: [],
        hearted: [],
        prefs: { ...DEFAULT_PREFS },
        device: uuid(),
      };
    }

    function read() {
      try {
        const raw = storage().getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== VERSION) return null;
        return {
          version: VERSION,
          rotation: Array.isArray(parsed.rotation) ? parsed.rotation : DEFAULT_ROTATION.slice(),
          own: Array.isArray(parsed.own) ? parsed.own.filter(validOwn) : [],
          simple: Array.isArray(parsed.simple) ? parsed.simple.filter((id) => typeof id === 'number') : [],
          hearted: Array.isArray(parsed.hearted) ? parsed.hearted.filter((id) => typeof id === 'string') : [],
          prefs: { ...DEFAULT_PREFS, ...(parsed.prefs || {}) },
          device: typeof parsed.device === 'string' ? parsed.device : uuid(),
        };
      } catch (_) {
        return null;
      }
    }

    function write() {
      try {
        storage().setItem(KEY, JSON.stringify(data));
        persistent = true;
      } catch (_) {
        persistent = false;
      }
    }

    function validOwn(item) {
      return item && typeof item.id === 'string' && item.id.startsWith('o-')
        && typeof item.challenge === 'string' && typeof item.response === 'string';
    }

    function ensure() {
      if (data) return;
      data = read() || defaults();
      write();
    }

    function clean(text, field) {
      const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
      if (!value) throw new Error(`The ${field} is empty.`);
      return value.slice(0, MAX_TEXT);
    }

    function fields({ challenge, response, category }) {
      const known = pool.categories.some((c) => c.name === category);
      return {
        category: known ? category : OWN.name,
        challenge: clean(challenge, "grown-up's line"),
        response: clean(response, "kids' line"),
      };
    }

    function view() {
      const affirmations = [...pool.affirmations, ...data.own.map((item) => ({ ...item, custom: true }))];
      const ids = new Set(affirmations.map((item) => item.id));
      return {
        categories: [...pool.categories, { ...OWN }],
        affirmations,
        rotation: data.rotation.filter((id, i, all) => ids.has(id) && all.indexOf(id) === i),
        simple: data.simple.filter((id) => ids.has(id)),
      };
    }

    function requirePool() {
      if (!pool) throw new Error('The affirmations have not loaded yet.');
      ensure();
    }

    return {
      get persistent() { ensure(); return persistent; },
      get device() { ensure(); return data.device; },

      prefs() {
        ensure();
        return { ...data.prefs };
      },

      savePrefs(prefs) {
        ensure();
        data.prefs = { ...DEFAULT_PREFS, ...prefs };
        write();
      },

      async load() {
        if (!pool) {
          const raw = await fetchPool();
          pool = { categories: raw.categories, affirmations: raw.affirmations };
        }
        ensure();
        return view();
      },

      setRotation(ids) {
        requirePool();
        const known = new Set(view().affirmations.map((item) => item.id));
        data.rotation = ids.filter((id, i) => known.has(id) && ids.indexOf(id) === i);
        write();
        return view();
      },

      addOwn(input) {
        requirePool();
        const copy = input.community && data.own.find((item) => item.community === input.community);
        if (copy) {
          if (!data.rotation.includes(copy.id)) data.rotation.push(copy.id);
          write();
          return { ...view(), added: copy };
        }
        const added = { id: `o-${uuid()}`, ...fields(input) };
        if (input.community) added.community = String(input.community);
        data.own.push(added);
        data.rotation.push(added.id);
        write();
        return { ...view(), added };
      },

      updateOwn(id, input) {
        requirePool();
        const item = data.own.find((other) => other.id === id);
        if (!item) throw new Error('That affirmation is gone.');
        Object.assign(item, fields(input));
        write();
        return view();
      },

      setSimple(id, on) {
        requirePool();
        const item = pool.affirmations.find((other) => other.id === id);
        if (!item || !item.simple) throw new Error('That affirmation has no simpler wording.');
        data.simple = data.simple.filter((other) => other !== id);
        if (on) data.simple.push(id);
        write();
        return view();
      },

      markShared(id) {
        requirePool();
        const item = data.own.find((other) => other.id === id);
        if (item) item.shared = true;
        write();
        return view();
      },

      hearted() {
        ensure();
        return data.hearted.slice();
      },

      markHearted(id) {
        ensure();
        if (!data.hearted.includes(id)) data.hearted.push(id);
        write();
      },

      deleteOwn(id) {
        requirePool();
        data.own = data.own.filter((other) => other.id !== id);
        data.rotation = data.rotation.filter((other) => other !== id);
        write();
        return view();
      },
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createStore, KEY, DEFAULT_ROTATION };
  } else {
    root.BedtimeStore = createStore({
      storage: () => root.localStorage,
      fetchPool: async () => {
        const response = await fetch('/pool.json');
        if (!response.ok) throw new Error(`Could not load the affirmations (${response.status}).`);
        return response.json();
      },
      uuid: () => (root.crypto && root.crypto.randomUUID
        ? root.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
