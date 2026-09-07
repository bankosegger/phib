require('dotenv').config();

const path = require('path');
const express = require('express');
const { nanoid } = require('nanoid');
const redis = require('./lib/redis');

const PORT = process.env.PORT || 3000;

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

function parseRecord(record) {
  return typeof record === 'string' ? JSON.parse(record) : record;
}

async function claimCode(code, target) {
  const claimed = await redis.set(
    `url:${code}`,
    { target, createdAt: new Date().toISOString() },
    { nx: true }
  );
  return claimed === 'OK';
}

app.post('/api/shorten', async (req, res) => {
  const { url, customCode } = req.body || {};

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid http/https URL.' });
  }

  const customTrimmed = customCode && customCode.trim();

  try {
    let code;

    if (customTrimmed) {
      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(customTrimmed)) {
        return res.status(400).json({ error: 'Custom code must be 3-20 characters (letters, numbers, - or _).' });
      }
      if (!(await claimCode(customTrimmed, url))) {
        return res.status(409).json({ error: 'That custom code is already taken.' });
      }
      code = customTrimmed;
    } else {
      for (let attempts = 0; attempts < 5 && !code; attempts++) {
        const candidate = nanoid(6);
        if (await claimCode(candidate, url)) {
          code = candidate;
        }
      }
      if (!code) {
        return res.status(500).json({ error: 'Could not generate a unique code, please try again.' });
      }
    }

    res.json({
      code,
      shortUrl: `${req.protocol}://${req.get('host')}/${code}`,
      target: url,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/stats/:code', async (req, res) => {
  try {
    const record = await redis.get(`url:${req.params.code}`);
    if (!record) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }
    const { target, createdAt } = parseRecord(record);
    const clicks = (await redis.get(`clicks:${req.params.code}`)) || 0;
    res.json({ code: req.params.code, target, createdAt, clicks: Number(clicks) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.get('/:code', async (req, res, next) => {
  try {
    const record = await redis.get(`url:${req.params.code}`);
    if (!record) {
      return next();
    }
    const { target } = parseRecord(record);
    redis.incr(`clicks:${req.params.code}`).catch((err) => console.error(err));
    res.redirect(target);
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Short URL server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
