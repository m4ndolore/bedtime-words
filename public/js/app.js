/* Bedtime words: a grown-up reads the top half, the kids answer with the bottom half.
 * One tap shows the kids' half, the next tap moves on. + adds an affirmation (a suggestion, a
 * category, or one the family writes), − takes the current one out of the rotation.
 */
(() => {
  'use strict';

  const OWN = 'Our Own';
  const sound = window.BedtimeSound;
  const store = window.BedtimeStore;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (id) => document.getElementById(id);

  const state = {
    pool: [],
    categories: [],
    rotation: [],
    order: [],
    index: 0,
    revealed: false,
    screen: 'start',
    swiped: false,
    adder: { category: null, skip: 0, editing: null },
    undo: null,
  };
  let prefs = store.prefs();
  let toastTimer = 0;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  /* ---------- Preferences (this device only) ---------- */

  function savePrefs() { store.savePrefs(prefs); }

  function nightPaper() {
    if (prefs.night !== null) return prefs.night;
    const hour = new Date().getHours();
    return hour >= 18 || hour < 7;
  }

  function applyPrefs() {
    const night = nightPaper();
    document.documentElement.dataset.paper = night ? 'night' : 'day';
    $('theme-color').setAttribute('content', night ? '#1d2232' : '#f3eee2');
    sound.configure({ sound: prefs.sound, music: prefs.music });
    $('opt-hide').checked = prefs.hide;
    $('opt-shuffle').checked = prefs.shuffle;
    $('opt-sound').checked = prefs.sound;
    $('opt-music').checked = prefs.music;
    $('opt-night').checked = night;
  }

  /* ---------- Browser store ---------- */

  function accept(payload) {
    state.pool = payload.affirmations;
    state.categories = payload.categories;
    state.rotation = payload.rotation;
  }

  async function load() {
    try {
      accept(await store.load());
      $('start-note').textContent = store.persistent ? '' : "This browser won't remember your set.";
    } catch (_) {
      $('start-note').textContent = state.pool.length
        ? 'Using the affirmations already loaded.'
        : 'Could not load the affirmations. Check the connection and reload.';
    }
    renderStart();
    if ($('editor').open) renderEditor();
    if ($('adder').open) renderAdder();
  }

  /* Run a change and report what went wrong, if anything. */
  function change(action, status) {
    try {
      action();
      return true;
    } catch (error) {
      status(error.message, true);
      return false;
    }
  }

  function putRotation(rotation) {
    accept(store.setRotation(rotation));
    renderStart();
  }

  function byId(id) { return state.pool.find((item) => item.id === id); }
  function saying(item) { return `${item.challenge} ${item.response}`; }

  /* ---------- Screens ---------- */

  function show(screen) {
    state.screen = screen;
    $('screen-start').hidden = screen !== 'start';
    $('screen-card').hidden = screen !== 'card';
    $('screen-done').hidden = screen !== 'done';
    const stepping = screen === 'card';
    $('prev').hidden = !stepping;
    $('next').hidden = !stepping;
    $('remove-current').hidden = !stepping;
  }

  function renderStart() {
    const count = state.rotation.length;
    $('start-count').textContent = count === 1
      ? '1 affirmation tonight'
      : count ? `${count} affirmations tonight` : 'The rotation is empty. Tap + to add one.';
    $('begin').disabled = count === 0;
    renderProgress();
  }

  function renderProgress() {
    const list = $('progress');
    const total = state.screen === 'start' ? state.rotation.length : state.order.length;
    list.replaceChildren();
    list.setAttribute('aria-label', state.screen === 'card'
      ? `Affirmation ${state.index + 1} of ${total}` : `${total} affirmations`);
    for (let i = 0; i < total; i += 1) {
      const done = state.screen === 'done' || (state.screen === 'card' && i < state.index);
      const current = state.screen === 'card' && i === state.index;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('doodle');
      const use = document.createElementNS(svgNS, 'use');
      use.setAttribute('href', '#star');
      use.setAttribute('width', '24');
      use.setAttribute('height', '24');
      svg.append(use);
      list.append(el('li', { class: [done && 'done', current && 'current'].filter(Boolean).join(' ') }, svg));
    }
  }

  function setWords(node, text) {
    node.classList.remove('shown');
    node.replaceChildren();
    text.split(/\s+/).forEach((word, i) => {
      if (i) node.append(' ');
      const span = el('span', { class: 'w', text: word });
      span.style.setProperty('--i', String(i));
      node.append(span);
    });
  }

  /* Shrink the words until they fit their half, so long and short lines both read from bed. */
  function fit(node) {
    const half = node.parentElement;
    const style = getComputedStyle(half);
    // Room inside the half, less its padding and the space kept for the "who" label and hint.
    const room = half.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 34;
    let size = Math.min(110, Math.max(28, half.clientWidth / 5.2));
    node.style.fontSize = `${size}px`;
    while (size > 22 && (node.offsetHeight > room || node.scrollWidth > node.clientWidth + 1)) {
      size -= 3;
      node.style.fontSize = `${size}px`;
    }
  }

  function fitAll() {
    if (state.screen !== 'card') return;
    fit($('challenge'));
    fit($('response'));
  }

  function wake(critter) {
    const node = document.querySelector(`.critter--${critter}`);
    node.classList.remove('awake');
    void node.getBoundingClientRect(); // restart the hop
    node.classList.add('awake');
  }

  function sleep(critter) { document.querySelector(`.critter--${critter}`).classList.remove('awake'); }

  function showCard() {
    const item = byId(state.order[state.index]);
    if (!item) return finish();
    show('card');
    setWords($('challenge'), item.challenge);
    setWords($('response'), item.response);
    state.revealed = false;
    $('response').parentElement.classList.remove('revealed');
    $('hint').textContent = prefs.hide ? "tap when you've said it" : 'tap for the next one';
    $('prev').disabled = state.index === 0;
    $('next').setAttribute('aria-label', state.index === state.order.length - 1 ? 'Finish' : 'Next affirmation');
    renderProgress();
    fitAll();
    wake('blue');
    sleep('red');
    requestAnimationFrame(() => {
      $('challenge').classList.add('shown');
      if (!prefs.hide) revealResponse(false);
    });
  }

  function revealResponse(withSound = true) {
    if (state.revealed) return;
    state.revealed = true;
    const response = $('response');
    response.parentElement.classList.add('revealed');
    response.classList.add('shown');
    wake('red');
    if (withSound) {
      sound.pencil(Math.min(6, 2 + Math.ceil(response.querySelectorAll('.w').length / 3)));
      sound.bell(state.index % 10, 0.12);
    }
  }

  function advance() {
    if (state.screen !== 'card') return;
    if (!state.revealed) {
      revealResponse();
      return;
    }
    goTo(state.index + 1);
  }

  function goTo(index) {
    if (index < 0) return;
    if (index >= state.order.length) return finish();
    state.index = index;
    sound.tap();
    sound.pencil(2);
    showCard();
  }

  function finish() {
    show('done');
    const count = state.order.length;
    $('done-count').textContent = count === 1 ? '1 affirmation said' : `${count} affirmations said`;
    renderProgress();
    sound.lullaby();
    // Let the music keep playing for a couple of minutes, then drift out.
    sound.fadePadLater(120, 25);
  }

  function shuffled(ids) {
    const copy = ids.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function begin() {
    if (!state.rotation.length) return;
    sound.unlock();
    sound.startPad();
    state.order = prefs.shuffle ? shuffled(state.rotation) : state.rotation.slice();
    state.index = 0;
    sound.bell(0, 0, 0.12);
    showCard();
  }

  /* ---------- Undo toast ---------- */

  function toast(text, undo) {
    clearTimeout(toastTimer);
    state.undo = undo || null;
    $('toast-text').textContent = text;
    $('toast-undo').hidden = !undo;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; state.undo = null; }, 7000);
  }

  function toastStatus(text, error) { if (error) toast(text); }

  /* ---------- − : take the current affirmation out of the rotation ---------- */

  function removeCurrent() {
    if (state.screen !== 'card') return;
    const id = state.order[state.index];
    const item = byId(id);
    const before = { rotation: state.rotation.slice(), order: state.order.slice(), index: state.index };
    const ok = change(() => putRotation(state.rotation.filter((other) => other !== id)), toastStatus);
    if (!ok) return;
    sound.pencil(3);
    state.order.splice(state.index, 1);
    toast(`Took out "${saying(item)}"`, () => {
      const restored = change(() => putRotation(before.rotation), toastStatus);
      if (!restored) return;
      if (state.screen === 'card' || state.screen === 'done') {
        state.order = before.order;
        state.index = before.index;
        showCard();
      }
      toast('Put it back.');
    });
    if (!state.order.length) {
      show('start');
      renderStart();
    } else if (state.index >= state.order.length) {
      finish();
    } else {
      showCard();
    }
  }

  /* ---------- + : add one more ---------- */

  function categoryCounts() {
    const counts = new Map();
    for (const id of state.rotation) {
      const item = byId(id);
      if (item) counts.set(item.category, (counts.get(item.category) || 0) + 1);
    }
    return counts;
  }

  /* Relevant first: the current card's category, then the categories with fewest in the
     rotation, then pool order. A chosen category narrows the list to that category. */
  function suggestions() {
    const inRotation = new Set(state.rotation);
    const current = state.screen === 'card' ? byId(state.order[state.index]) : null;
    const counts = categoryCounts();
    const order = new Map(state.pool.map((item, i) => [item.id, i]));
    return state.pool
      .filter((item) => !inRotation.has(item.id))
      .filter((item) => !state.adder.category || item.category === state.adder.category)
      .sort((a, b) => {
        const near = (item) => (current && item.category === current.category ? 0 : 1);
        return near(a) - near(b)
          || (counts.get(a.category) || 0) - (counts.get(b.category) || 0)
          || order.get(a.id) - order.get(b.id);
      });
  }

  function adderStatus(text, error = false) {
    const node = $('adder-status');
    node.textContent = text;
    node.classList.toggle('error', error);
  }

  function renderChips() {
    const chips = $('adder-chips');
    chips.replaceChildren();
    const options = [{ name: null, label: 'Any' }, ...state.categories.map((c) => ({ name: c.name, label: c.name }))];
    for (const option of options) {
      const chip = el('button', {
        type: 'button',
        class: 'chip',
        text: option.label,
        'aria-pressed': String(state.adder.category === option.name),
      });
      chip.addEventListener('click', () => {
        state.adder.category = option.name;
        state.adder.skip = 0;
        if (option.name) $('writer-category').value = option.name;
        renderAdder();
      });
      chips.append(chip);
    }
  }

  function renderSuggestion() {
    const list = suggestions();
    const empty = !list.length;
    $('suggestion').hidden = empty;
    $('suggestion-empty').hidden = !empty;
    if (empty) return;
    const item = list[state.adder.skip % list.length];
    $('suggestion').dataset.id = String(item.id);
    $('suggestion-challenge').textContent = item.challenge;
    $('suggestion-response').textContent = item.response;
    $('suggestion-meta').textContent = list.length > 1
      ? `${item.category} · ${(state.adder.skip % list.length) + 1} of ${list.length}`
      : item.category;
    $('suggestion-skip').hidden = list.length < 2;
  }

  function renderWriterCategories() {
    const select = $('writer-category');
    const keep = select.value || OWN;
    select.replaceChildren(...state.categories.map((c) => el('option', { value: c.name, text: c.name })));
    select.value = state.categories.some((c) => c.name === keep) ? keep : OWN;
  }

  function renderAdder() {
    renderChips();
    renderSuggestion();
    renderWriterCategories();
  }

  function openAdder({ write = false } = {}) {
    sound.unlock();
    if ($('editor').open) $('editor').close();
    state.adder.skip = 0;
    adderStatus('');
    resetWriter();
    renderAdder();
    $('adder').showModal();
    if (write) $('writer-challenge').focus();
    load();
  }

  /* Something added mid-session comes up next, so it is practiced tonight. */
  function practiceNext(id) {
    if (state.screen !== 'card' || state.order.includes(id)) return;
    state.order.splice(state.index + 1, 0, id);
    renderProgress();
  }

  function addSuggestion() {
    const item = state.pool.find((other) => String(other.id) === $('suggestion').dataset.id);
    if (!item) return;
    const { id } = item;
    const ok = change(() => putRotation([...state.rotation, id]), adderStatus);
    if (!ok) return;
    practiceNext(id);
    sound.bell(4, 0, 0.12);
    adderStatus(state.screen === 'card'
      ? `Added, and it's next: "${saying(item)}"`
      : `Added: "${saying(item)}" (${state.rotation.length} in the rotation)`);
    renderAdder();
  }

  /* ---------- Writing our own ---------- */

  function resetWriter() {
    state.adder.editing = null;
    $('writer').reset();
    $('writer-title').textContent = 'write our own';
    $('writer-submit').textContent = 'Add to the rotation';
    $('writer-delete').hidden = true;
    $('writer-cancel').hidden = true;
    renderWriterCategories();
    $('writer-category').value = state.adder.category || OWN;
  }

  function editOwn(item) {
    openAdder();
    state.adder.editing = item.id;
    $('writer-title').textContent = 'edit our own';
    $('writer-challenge').value = item.challenge;
    $('writer-response').value = item.response;
    $('writer-category').value = item.category;
    $('writer-submit').textContent = 'Save changes';
    $('writer-delete').hidden = false;
    $('writer-cancel').hidden = false;
    $('writer').scrollIntoView({ block: 'start' });
  }

  function submitWriter(event) {
    event.preventDefault();
    const body = {
      challenge: $('writer-challenge').value.trim(),
      response: $('writer-response').value.trim(),
      category: $('writer-category').value,
    };
    if (!body.challenge || !body.response) return;
    const editing = state.adder.editing;
    const ok = change(() => {
      if (editing) {
        accept(store.updateOwn(editing, body));
      } else {
        const payload = store.addOwn(body);
        accept(payload);
        practiceNext(payload.added.id);
      }
      renderStart();
    }, adderStatus);
    if (!ok) return;
    sound.bell(6, 0, 0.12);
    adderStatus(editing ? 'Saved.' : `Added to the rotation: "${body.challenge} ${body.response}"`);
    resetWriter();
    renderAdder();
  }

  function deleteOwn() {
    const id = state.adder.editing;
    const item = byId(id);
    if (!item || !window.confirm(`Delete "${saying(item)}"? It leaves the rotation too.`)) return;
    const ok = change(() => {
      accept(store.deleteOwn(id));
      state.order = state.order.filter((other) => other !== id);
      renderStart();
    }, adderStatus);
    if (!ok) return;
    adderStatus('Deleted.');
    resetWriter();
    renderAdder();
  }

  /* ---------- Settings ---------- */

  function bindToggle(id, key) {
    $(id).addEventListener('change', (event) => {
      prefs[key] = event.target.checked;
      savePrefs();
      applyPrefs();
      if (key === 'music' && prefs.music && state.screen !== 'start') sound.startPad();
    });
  }

  /* ---------- Rotation editor ---------- */

  function editorStatus(text, error = false) {
    const node = $('editor-status');
    node.textContent = text;
    node.classList.toggle('error', error);
  }

  function pickRow(item, buttons, number) {
    const text = el('p', { class: 'pick-text' },
      number ? el('span', { class: 'pick-number', text: `${number}.` }) : null,
      el('span', { class: 'c', text: item.challenge }), ' ',
      el('span', { class: 'r', text: item.response }),
      el('span', { class: 'pick-meta', text: item.custom ? `${item.category} · written by us` : item.category }));
    return el('li', { class: 'pick' }, text, el('div', { class: 'pick-buttons' }, ...buttons));
  }

  function editButton(item) {
    if (!item.custom) return null;
    const button = el('button', { type: 'button', class: 'pick-button', text: 'Edit', 'aria-label': `Edit "${saying(item)}"` });
    button.addEventListener('click', () => editOwn(item));
    return button;
  }

  function saveRotation(rotation, message) {
    const ok = change(() => putRotation(rotation), editorStatus);
    if (!ok) return;
    editorStatus(`${message} ${state.rotation.length} in the rotation.`);
    renderEditor();
  }

  function renderEditor() {
    const inRotation = new Set(state.rotation);
    const rotationList = $('rotation-list');
    rotationList.replaceChildren();
    if (!state.rotation.length) {
      rotationList.append(el('li', { class: 'pool-empty', text: 'Nothing in the rotation yet. Add some from the pool below.' }));
    }
    state.rotation.forEach((id, index) => {
      const item = byId(id);
      if (!item) return;
      const remove = el('button', { type: 'button', class: 'pick-button', text: 'Remove', 'aria-label': `Remove "${saying(item)}"` });
      remove.addEventListener('click', () => saveRotation(state.rotation.filter((other) => other !== id), 'Removed.'));
      rotationList.append(pickRow(item, [editButton(item), remove], index + 1));
    });

    const pool = $('pool-list');
    const openCategories = new Set([...pool.querySelectorAll('details[open]')].map((node) => node.dataset.category));
    pool.replaceChildren();
    for (const category of state.categories) {
      const items = state.pool.filter((item) => item.category === category.name);
      if (!items.length && category.name !== OWN) continue;
      const waiting = items.filter((item) => !inRotation.has(item.id));
      const list = el('ol', { class: 'pick-list' });
      for (const item of waiting) {
        const add = el('button', { type: 'button', class: 'pick-button pick-button--add', text: 'Add', 'aria-label': `Add "${saying(item)}"` });
        add.addEventListener('click', () => saveRotation([...state.rotation, item.id], 'Added to the rotation.'));
        list.append(pickRow(item, [editButton(item), add]));
      }
      if (!items.length) list.append(el('li', { class: 'pool-empty', text: 'None yet. Tap "Write our own" above.' }));
      else if (!waiting.length) list.append(el('li', { class: 'pool-empty', text: 'All of these are in the rotation.' }));
      const details = el('details', { 'data-category': category.name, open: openCategories.has(category.name) },
        el('summary', {}, el('span', { text: category.name }),
          el('small', { text: `${items.length - waiting.length} of ${items.length} in rotation` })),
        list);
      pool.append(details);
    }

    const next = state.pool.find((item) => !inRotation.has(item.id));
    $('add-next').disabled = !next;
    $('add-next').textContent = next ? `Add the next one: "${saying(next)}"` : 'Every affirmation is in the rotation';

    const select = $('fresh-count');
    if (select.options.length !== state.pool.length) {
      select.replaceChildren(...state.pool.map((_, i) => el('option', { value: String(i + 1), text: String(i + 1) })));
      select.value = '3';
    }
  }

  function openEditor() {
    $('settings').close();
    editorStatus('');
    renderEditor();
    $('editor').showModal();
    load();
  }

  /* ---------- Hand-drawn boil ---------- */

  function startBoil() {
    const noise = $('wobble-noise');
    let seed = 1;
    let timer = null;
    const run = () => {
      clearInterval(timer);
      timer = null;
      if (reduceMotion.matches || document.visibilityState !== 'visible') return;
      timer = setInterval(() => {
        seed = (seed % 3) + 1;
        noise.setAttribute('seed', String(seed));
      }, 180);
    };
    document.addEventListener('visibilitychange', run);
    reduceMotion.addEventListener('change', run);
    run();
  }

  /* ---------- Input ---------- */

  function bindStage() {
    const card = $('screen-card');
    let startX = 0;
    let startY = 0;
    card.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
      state.swiped = false;
    });
    card.addEventListener('pointerup', (event) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        state.swiped = true;
        if (dx < 0) goTo(state.index + 1);
        else goTo(state.index - 1);
      }
    });
    card.addEventListener('click', () => {
      if (state.swiped) return;
      advance();
    });

    document.addEventListener('keydown', (event) => {
      if (document.querySelector('dialog[open]')) return;
      if (state.screen === 'start' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        begin();
      } else if (state.screen === 'card') {
        if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (event.key === 'ArrowRight') goTo(state.index + 1);
          else advance();
        } else if (event.key === 'ArrowLeft') {
          goTo(state.index - 1);
        }
      }
    });
  }

  function init() {
    if (window.top !== window) document.documentElement.classList.add('framed');
    applyPrefs();
    show('start');
    bindStage();
    startBoil();

    $('begin').addEventListener('click', begin);
    $('again').addEventListener('click', begin);
    $('prev').addEventListener('click', () => goTo(state.index - 1));
    $('next').addEventListener('click', () => goTo(state.index + 1));
    $('remove-current').addEventListener('click', removeCurrent);
    $('add-more').addEventListener('click', () => openAdder());
    $('toast-undo').addEventListener('click', () => {
      const undo = state.undo;
      $('toast').hidden = true;
      state.undo = null;
      if (undo) undo();
    });

    $('suggestion-skip').addEventListener('click', () => {
      state.adder.skip += 1;
      sound.pencil(2);
      renderSuggestion();
    });
    $('suggestion-add').addEventListener('click', addSuggestion);
    $('close-adder').addEventListener('click', () => $('adder').close());
    $('writer').addEventListener('submit', submitWriter);
    $('writer-cancel').addEventListener('click', resetWriter);
    $('writer-delete').addEventListener('click', deleteOwn);

    $('open-settings').addEventListener('click', () => { sound.unlock(); $('settings').showModal(); });
    bindToggle('opt-hide', 'hide');
    bindToggle('opt-shuffle', 'shuffle');
    bindToggle('opt-sound', 'sound');
    bindToggle('opt-music', 'music');
    bindToggle('opt-night', 'night');
    $('open-editor').addEventListener('click', openEditor);
    $('open-writer').addEventListener('click', () => openAdder({ write: true }));
    $('close-editor').addEventListener('click', () => $('editor').close());
    $('add-next').addEventListener('click', () => {
      const next = state.pool.find((item) => !state.rotation.includes(item.id));
      if (next) saveRotation([...state.rotation, next.id], 'Added to the rotation.');
    });
    $('start-fresh').addEventListener('click', () => {
      const count = Number($('fresh-count').value);
      if (!window.confirm(`Replace the rotation with the first ${count} affirmations?`)) return;
      saveRotation(state.pool.slice(0, count).map((item) => item.id), 'Started over.');
    });

    // Tap outside a sheet to close it.
    for (const dialog of document.querySelectorAll('dialog.sheet')) {
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitAll);
    });
    if (document.fonts) document.fonts.ready.then(fitAll);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.screen === 'start') load();
    });
    load();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  init();
})();
