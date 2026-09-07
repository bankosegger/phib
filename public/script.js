const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const customCodeInput = document.getElementById('custom-code');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLinkEl = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const historyEl = document.getElementById('history');

const HISTORY_KEY = 'phib-history';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
}

function renderHistory() {
  const items = loadHistory();
  historyEl.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = item.shortUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.shortUrl.replace(/^https?:\/\//, '');
    const span = document.createElement('span');
    span.className = 'target';
    span.textContent = item.target;
    li.appendChild(a);
    li.appendChild(span);
    historyEl.appendChild(li);
  }
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
}

function showResult(data) {
  errorEl.hidden = true;
  shortLinkEl.href = data.shortUrl;
  shortLinkEl.textContent = data.shortUrl;
  resultEl.hidden = false;

  const items = loadHistory();
  items.unshift(data);
  saveHistory(items);
  renderHistory();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const url = urlInput.value.trim();
  const customCode = customCodeInput.value.trim();

  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, customCode: customCode || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong.');
      return;
    }

    showResult(data);
    urlInput.value = '';
    customCodeInput.value = '';
  } catch {
    showError('Could not reach the server. Please try again.');
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shortLinkEl.href);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  } catch {
    copyBtn.textContent = 'Failed';
  }
});

renderHistory();
