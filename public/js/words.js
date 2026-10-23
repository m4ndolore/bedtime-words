/* Lists the built-in pool by category, so the wording can be read in one place. */
(async () => {
  'use strict';
  const root = document.getElementById('words');
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  try {
    const response = await fetch('/pool.json');
    if (!response.ok) throw new Error(String(response.status));
    const pool = await response.json();
    root.replaceChildren();
    for (const category of pool.categories) {
      const items = pool.affirmations.filter((item) => item.category === category.name);
      if (!items.length) continue;
      root.append(el('h2', null, category.name), el('p', 'note', category.description));
      const list = el('ol', 'words');
      for (const item of items) {
        const li = el('li');
        li.value = item.id;
        li.append(el('span', 'c', item.challenge), ' ', el('span', 'r', item.response), el('span', 'id', `#${item.id}`));
        list.append(li);
      }
      root.append(list);
    }
  } catch (_) {
    root.replaceChildren(el('p', 'note', 'Could not load the affirmations. Check the connection and reload.'));
  }
})();
