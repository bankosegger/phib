const loginForm = document.getElementById('login-form');
const tokenInput = document.getElementById('token-input');
const errorEl = document.getElementById('error');
const dashboardEl = document.getElementById('dashboard');
const filterInput = document.getElementById('filter-input');
const linksBody = document.getElementById('links-body');
const emptyEl = document.getElementById('empty');

// sessionStorage so the token is forgotten when the tab closes.
const TOKEN_KEY = 'phib-admin-token';

let links = [];
let sort = { key: 'createdAt', desc: true };

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY)}` },
  });
  if (res.status === 401) {
    signOut();
    throw new Error('Wrong admin token.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Something went wrong.');
  }
  return res.status === 204 ? null : res.json();
}

async function load() {
  showError('');
  try {
    ({ links } = await api('/api/admin/links'));
    loginForm.hidden = true;
    dashboardEl.hidden = false;
    render();
  } catch (err) {
    showError(err.message);
  }
}

function signOut() {
  sessionStorage.removeItem(TOKEN_KEY);
  links = [];
  loginForm.hidden = false;
  dashboardEl.hidden = true;
}

function describeTarget(link) {
  if (link.tweet) {
    return `@${link.tweet.handle}: ${link.tweet.text}`;
  }
  return link.target.replace(/^https?:\/\/(www\.)?/, '');
}

function compare(a, b) {
  const x = a[sort.key] ?? '';
  const y = b[sort.key] ?? '';
  const order = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
  return sort.desc ? -order : order;
}

function render() {
  const total = links.reduce((sum, link) => sum + link.clicks, 0);
  document.getElementById('stat-links').textContent = links.length.toLocaleString();
  document.getElementById('stat-clicks').textContent = total.toLocaleString();
  document.getElementById('stat-unclicked').textContent = links.filter((link) => !link.clicks).length.toLocaleString();

  for (const btn of document.querySelectorAll('.sort-btn')) {
    btn.dataset.active = btn.dataset.sort === sort.key ? (sort.desc ? 'desc' : 'asc') : '';
  }

  const query = filterInput.value.trim().toLowerCase();
  const visible = links
    .filter((link) => !query || `${link.code} ${link.target} ${describeTarget(link)}`.toLowerCase().includes(query))
    .sort(compare);

  linksBody.innerHTML = '';
  for (const link of visible) {
    const tr = document.createElement('tr');

    const codeCell = document.createElement('td');
    const a = document.createElement('a');
    a.href = link.shortUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link.code;
    codeCell.appendChild(a);

    const targetCell = document.createElement('td');
    targetCell.className = 'admin-target';
    const target = document.createElement('a');
    target.href = link.tweet ? link.tweet.url : link.target;
    target.target = '_blank';
    target.rel = 'noopener';
    target.textContent = describeTarget(link);
    target.title = link.target;
    targetCell.appendChild(target);

    const createdCell = document.createElement('td');
    createdCell.className = 'admin-muted';
    if (link.createdAt) {
      const date = new Date(link.createdAt);
      createdCell.textContent = date.toLocaleDateString();
      createdCell.title = date.toLocaleString();
    }

    const clicksCell = document.createElement('td');
    clicksCell.className = 'num';
    clicksCell.textContent = link.clicks.toLocaleString();

    const actionCell = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-btn';
    del.textContent = 'delete';
    del.addEventListener('click', () => remove(link, del));
    actionCell.appendChild(del);

    tr.append(codeCell, targetCell, createdCell, clicksCell, actionCell);
    linksBody.appendChild(tr);
  }
  emptyEl.hidden = visible.length > 0;
}

async function remove(link, button) {
  if (!confirm(`Delete ${link.shortUrl}? It will stop working immediately.`)) {
    return;
  }
  button.disabled = true;
  showError('');
  try {
    await api(`/api/admin/links/${encodeURIComponent(link.code)}`, { method: 'DELETE' });
    links = links.filter((item) => item !== link);
    render();
  } catch (err) {
    button.disabled = false;
    showError(err.message);
  }
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sessionStorage.setItem(TOKEN_KEY, tokenInput.value);
  tokenInput.value = '';
  load();
});

document.getElementById('refresh-btn').addEventListener('click', load);
document.getElementById('logout-btn').addEventListener('click', signOut);
filterInput.addEventListener('input', render);

for (const btn of document.querySelectorAll('.sort-btn')) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.sort;
    sort = { key, desc: sort.key === key ? !sort.desc : key !== 'code' };
    render();
  });
}

if (sessionStorage.getItem(TOKEN_KEY)) {
  load();
}
