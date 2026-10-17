require('dotenv').config();

const path = require('path');
const express = require('express');
const { nanoid } = require('nanoid');
const redis = require('./lib/redis');
const { parseStatus, resolveTwitterVideo, TwitterError } = require('./lib/twitter');
const { renderWatchPage } = require('./lib/watch');

const PORT = process.env.PORT || 3000;
const SHORT_DOMAIN = process.env.SHORT_DOMAIN;

if (!SHORT_DOMAIN) {
  throw new Error('Missing SHORT_DOMAIN environment variable.');
}

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

function isOwnDomain(value) {
  return new URL(value).hostname.toLowerCase() === SHORT_DOMAIN.toLowerCase();
}

function parseRecord(record) {
  return typeof record === 'string' ? JSON.parse(record) : record;
}

async function claimCode(code, target, tweet) {
  const claimed = await redis.set(
    `url:${code}`,
    { target, createdAt: new Date().toISOString(), tweet },
    { nx: true }
  );
  return claimed === 'OK';
}

app.post('/api/shorten', async (req, res) => {
  let { url, twitterVideo } = req.body || {};

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid http/https URL.' });
  }

  if (isOwnDomain(url)) {
    return res.status(400).json({ error: 'That URL is already a short link from this site.' });
  }

  try {
    const source = url;
    const status = twitterVideo === true ? parseStatus(url) : null;
    let tweet;
    if (status) {
      ({ url, tweet } = await resolveTwitterVideo(status));
    }

    let code;

    for (let attempts = 0; attempts < 5 && !code; attempts++) {
      const candidate = nanoid(6);
      if (await claimCode(candidate, url, tweet)) {
        code = candidate;
      }
    }
    if (!code) {
      return res.status(500).json({ error: 'Could not generate a unique code, please try again.' });
    }

    res.json({
      code,
      shortUrl: `https://${SHORT_DOMAIN}/${code}`,
      target: url,
      source,
      tweet,
    });
  } catch (err) {
    if (err instanceof TwitterError) {
      return res.status(400).json({ error: err.message });
    }
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
    const { target, tweet } = parseRecord(record);
    redis.incr(`clicks:${req.params.code}`).catch((err) => console.error(err));
    if (tweet) {
      return res.send(renderWatchPage({ target, tweet }));
    }
    // Hosts like video.twimg.com reject requests whose Referer is another site.
    res.set('Referrer-Policy', 'no-referrer');
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
