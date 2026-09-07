const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, 'urls.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS urls (
    code TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    clicks INTEGER NOT NULL DEFAULT 0
  )
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/api/shorten', (req, res) => {
  const { url, customCode } = req.body || {};

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid http/https URL.' });
  }

  let code = customCode && customCode.trim();

  if (code) {
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(code)) {
      return res.status(400).json({ error: 'Custom code must be 3-20 characters (letters, numbers, - or _).' });
    }
    const existing = db.prepare('SELECT code FROM urls WHERE code = ?').get(code);
    if (existing) {
      return res.status(409).json({ error: 'That custom code is already taken.' });
    }
  } else {
    do {
      code = nanoid(6);
    } while (db.prepare('SELECT code FROM urls WHERE code = ?').get(code));
  }

  db.prepare('INSERT INTO urls (code, target) VALUES (?, ?)').run(code, url);

  res.json({
    code,
    shortUrl: `${req.protocol}://${req.get('host')}/${code}`,
    target: url,
  });
});

app.get('/api/stats/:code', (req, res) => {
  const row = db.prepare('SELECT code, target, created_at, clicks FROM urls WHERE code = ?').get(req.params.code);
  if (!row) {
    return res.status(404).json({ error: 'Short URL not found.' });
  }
  res.json(row);
});

app.get('/:code', (req, res, next) => {
  const row = db.prepare('SELECT target FROM urls WHERE code = ?').get(req.params.code);
  if (!row) {
    return next();
  }
  db.prepare('UPDATE urls SET clicks = clicks + 1 WHERE code = ?').run(req.params.code);
  res.redirect(row.target);
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`Short URL server running at http://localhost:${PORT}`);
});
