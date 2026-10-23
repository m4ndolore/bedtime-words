'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, KEY } = require('../public/js/store.js');

const POOL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'pool.json'), 'utf8'));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: (key) => JSON.parse(map.get(key)),
  };
}

function make(storage) {
  let n = 0;
  return createStore({
    storage: () => storage,
    fetchPool: async () => POOL,
    uuid: () => `id-${(n += 1)}`,
  });
}

test('defaults: a new browser starts with the first three affirmations', async () => {
  // protects=first visit shows 3 affirmations tonight; fails_when=defaults are empty, wrong ids, or not saved; no_claim=pool.json content beyond ids 1-3 (fixture is the real pool file)
  const storage = memoryStorage();
  const view = await make(storage).load();
  assert.deepEqual(view.rotation, [1, 2, 3]);
  assert.equal(view.categories.at(-1).name, 'Our Own');
  assert.deepEqual(storage.dump(KEY).rotation, [1, 2, 3]);
});

test('save and load: a second store over the same storage sees the set and own affirmations', async () => {
  // protects=a reload keeps the set; fails_when=rotation, own text or prefs are lost or reordered; no_claim=real localStorage quotas (in-memory storage stands in)
  const storage = memoryStorage();
  const first = make(storage);
  await first.load();
  first.setRotation([5, 1]);
  first.addOwn({ challenge: 'When I feel left out,', response: 'I know my family loves me.', category: 'Our Own' });
  first.savePrefs({ ...first.prefs(), shuffle: true });

  const second = make(storage);
  const view = await second.load();
  const own = view.affirmations.filter((item) => item.custom);
  assert.equal(own.length, 1);
  assert.equal(own[0].response, 'I know my family loves me.');
  assert.deepEqual(view.rotation, [5, 1, own[0].id]);
  assert.equal(second.prefs().shuffle, true);
});

test('own ids: family-written affirmations get o- ids that never collide with the pool', async () => {
  // protects=own affirmations stay distinct from pool ids; fails_when=an own id is numeric or reuses an id; no_claim=randomUUID uniqueness in browsers (counter uuid stands in)
  const store = make(memoryStorage());
  await store.load();
  const a = store.addOwn({ challenge: 'One', response: 'two', category: 'Nope' }).added;
  const b = store.addOwn({ challenge: 'Three', response: 'four' }).added;
  assert.match(a.id, /^o-/);
  assert.notEqual(a.id, b.id);
  assert.equal(a.category, 'Our Own', 'unknown categories fall back to Our Own');
  assert.throws(() => store.addOwn({ challenge: '   ', response: 'x' }), /empty/);
});

test('delete own: removing one also takes it out of the rotation', async () => {
  // protects=deleted affirmations never come up at bedtime; fails_when=the id stays in the rotation; no_claim=UI confirm dialog
  const store = make(memoryStorage());
  await store.load();
  const { added } = store.addOwn({ challenge: 'A', response: 'b' });
  const view = store.deleteOwn(added.id);
  assert.ok(!view.rotation.includes(added.id));
  assert.ok(!view.affirmations.some((item) => item.id === added.id));
});

test('blocked storage: the store still works for the visit and reports it will not remember', async () => {
  // protects=private mode still runs a session and shows the warning; fails_when=load throws or persistent stays true; no_claim=which browsers block storage (a throwing accessor stands in)
  const store = createStore({
    storage: () => { throw new Error('SecurityError'); },
    fetchPool: async () => POOL,
    uuid: () => 'x',
  });
  const view = await store.load();
  assert.deepEqual(view.rotation, [1, 2, 3]);
  assert.equal(store.persistent, false);
  assert.deepEqual(store.setRotation([4]).rotation, [4]);
});

test('unknown version: a stored object from another version is ignored and defaults load', async () => {
  // protects=a future or corrupt save never crashes the page; fails_when=load throws or keeps the foreign rotation; no_claim=migrations (none exist yet)
  const storage = memoryStorage({ [KEY]: JSON.stringify({ version: 99, rotation: [40, 41] }) });
  const view = await make(storage).load();
  assert.deepEqual(view.rotation, [1, 2, 3]);
  const corrupt = memoryStorage({ [KEY]: '{not json' });
  assert.deepEqual((await make(corrupt).load()).rotation, [1, 2, 3]);
});

test('public pool: no family-specific names', () => {
  // protects=epic DoD 8 (#22 and #27 read "my family"); fails_when=Dad, Mom or Mam appear in any pool text; no_claim=other names not on this list
  const text = POOL.affirmations.map((item) => `${item.challenge} ${item.response}`).join('\n');
  assert.doesNotMatch(text, /\b(Dad|Mom|Mam)\b/);
  assert.equal(POOL.affirmations.find((item) => item.id === 22).challenge, 'My family loves');
  assert.equal(POOL.affirmations.find((item) => item.id === 27).challenge, 'What my family wants most');
});

test('simpler wording: the choice is per affirmation and survives a reload until switched back', async () => {
  // protects=a family that picks simpler words for one affirmation keeps them on that one only; fails_when=the choice is lost on reload, leaks to other ids, or cannot be undone; no_claim=card rendering (covered by e2e)
  const storage = memoryStorage();
  const first = make(storage);
  await first.load();
  assert.deepEqual(first.setSimple(9, true).simple, [9]);
  const second = make(storage);
  assert.deepEqual((await second.load()).simple, [9]);
  assert.deepEqual(second.setSimple(9, false).simple, []);
  assert.throws(() => second.setSimple(1, true), /no simpler wording/);
});

test('older saves: a version 1 save from before simpler wording loads with none chosen', async () => {
  // protects=families who saved before this release keep their set; fails_when=load throws or drops the rotation; no_claim=other missing fields
  const storage = memoryStorage({ [KEY]: JSON.stringify({ version: 1, rotation: [4, 9], own: [], prefs: {}, device: 'd' }) });
  const view = await make(storage).load();
  assert.deepEqual(view.rotation, [4, 9]);
  assert.deepEqual(view.simple, []);
});

test('pool wording: every simpler version has both halves, and #5 reads as reviewed', () => {
  // protects=the reviewed wording ships as written; fails_when=a simpler version is missing a half or #5 reverts; no_claim=the wording itself is right (the maintainer reviewed it)
  for (const item of POOL.affirmations.filter((other) => other.simple)) {
    assert.ok(item.simple.challenge.trim() && item.simple.response.trim(), `#${item.id}`);
  }
  assert.equal(POOL.affirmations.filter((item) => item.simple).length, 41);
  assert.equal(POOL.affirmations.find((item) => item.id === 5).response, 'confidence I can figure it out.');
});

test('community copies: adding a shared affirmation keeps one local copy, and shared/hearted marks persist', async () => {
  // protects=an affirmation from other families works offline and is not duplicated; fails_when=adding twice makes two copies, or shared/hearted marks are lost on reload; no_claim=the community API (not involved)
  const storage = memoryStorage();
  const store = make(storage);
  await store.load();
  const first = store.addOwn({ challenge: 'A', response: 'b', category: 'Kindness', community: 'sub-1' }).added;
  const again = store.addOwn({ challenge: 'A', response: 'b', category: 'Kindness', community: 'sub-1' }).added;
  assert.equal(first.id, again.id);
  const mine = store.addOwn({ challenge: 'C', response: 'd' }).added;
  store.markShared(mine.id);
  store.markHearted('sub-1');
  const reloaded = make(storage);
  const view = await reloaded.load();
  const own = view.affirmations.filter((item) => item.custom);
  assert.equal(own.length, 2);
  assert.equal(own.find((item) => item.id === first.id).community, 'sub-1');
  assert.equal(own.find((item) => item.id === mine.id).shared, true);
  assert.deepEqual(reloaded.hearted(), ['sub-1']);
  assert.equal(typeof reloaded.device, 'string');
});
