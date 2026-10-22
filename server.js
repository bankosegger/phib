require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { nanoid } = require('nanoid');
const redis = require('./lib/redis');
const { Readable } = require('stream');
const { parseStatus, resolveTweet, fetchReplies, TwitterError, isTwimg } = require('./lib/twitter');
const { renderWatchPage } = require('./lib/watch');

const PORT = process.env.PORT || 3000;
// Vercel caps function responses at 4.5 MB, so video is served in ranges up to this size.
const MEDIA_CHUNK = 4 * 1024 * 1024;
const SHORT_DOMAIN = process.env.SHORT_DOMAIN;
// Leaving ADMIN_TOKEN unset disables the admin dashboard.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

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
      ({ url, tweet } = await resolveTweet(status));
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
    console.error(err);
    
    if (err instanceof TwitterError) {
      return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/stats/:code', async (req, res) => {
  try {
    const [record, clicks] = await redis.mget(`url:${req.params.code}`, `clicks:${req.params.code}`);
    if (!record) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }
    const { target, createdAt } = parseRecord(record);
    res.json({ code: req.params.code, target, createdAt, clicks: Number(clicks) || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.get('/api/replies/:id', async (req, res) => {
  if (!/^\d{1,20}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tweet id.' });
  }
  try {
    const replies = await fetchReplies(req.params.id);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ replies });
  } catch (err) {
    if (!(err instanceof TwitterError)) {
      console.error(err);
    }
    res.status(502).json({ error: 'Could not load replies.' });
  }
});

app.get('/api', (req, res) => {
  res.json({
    name: 'phib',
    description: 'Paste a long URL, get a short one.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/shorten',
        body: { url: 'https://example.com', twitterVideo: 'optional boolean' },
        description: 'Shortens a URL. With twitterVideo: true, Twitter/X post links open the post in phib, pointing to its video when it has one.',
      },
      {
        method: 'GET',
        path: '/api/stats/:code',
        description: 'Target, creation date and click count of a short link.',
      },
      {
        method: 'GET',
        path: '/api/replies/:tweetId',
        description: 'Top replies of a Twitter/X post.',
      },
    ],
  });
});

function requireAdmin(req, res, next) {
  const given = Buffer.from((req.get('Authorization') || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(ADMIN_TOKEN || '');
  if (!ADMIN_TOKEN || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Wrong admin token.' });
  }
  next();
}

async function listCodes() {
  const codes = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'url:*', count: 1000 });
    cursor = String(next);
    codes.push(...keys.map((key) => key.slice('url:'.length)));
  } while (cursor !== '0');
  return codes;
}

app.get('/api/admin/links', requireAdmin, async (req, res) => {
  try {
    const codes = await listCodes();
    const links = [];
    // Keeps each Upstash request well under its size limit.
    for (let i = 0; i < codes.length; i += 500) {
      const batch = codes.slice(i, i + 500);
      const values = await redis.mget(...batch.flatMap((code) => [`url:${code}`, `clicks:${code}`]));
      batch.forEach((code, j) => {
        const record = values[j * 2];
        if (!record) {
          return;
        }
        const { target, createdAt, tweet } = parseRecord(record);
        links.push({
          code,
          shortUrl: `https://${SHORT_DOMAIN}/${code}`,
          target,
          createdAt,
          clicks: Number(values[j * 2 + 1]) || 0,
          tweet: tweet ? { url: tweet.url, handle: tweet.author.handle, text: tweet.text } : null,
        });
      });
    }
    links.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ links });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.delete('/api/admin/links/:code', requireAdmin, async (req, res) => {
  try {
    const removed = await redis.del(`url:${req.params.code}`, `clicks:${req.params.code}`);
    if (!removed) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint. See /api for the list.' });
});

app.get('/media', async (req, res, next) => {
  const { url } = req.query;
  let valid = false;
  try {
    valid = typeof url === 'string' && isTwimg(url);
  } catch {}
  if (!valid) {
    return res.status(400).json({ error: 'Only Twitter media can be loaded.' });
  }

  const headers = {};
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.get('Range') || '');
  if (range) {
    const start = Number(range[1]);
    const maxEnd = start + MEDIA_CHUNK - 1;
    const end = range[2] ? Math.min(Number(range[2]), maxEnd) : maxEnd;
    headers.Range = `bytes=${start}-${end}`;
  }

  try {
    const upstream = await fetch(url, { headers });
    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) {
        res.set(name, value);
      }
    }
    res.set('Cache-Control', 'public, max-age=86400');
    if (!upstream.body) {
      return res.end();
    }
    Readable.fromWeb(upstream.body).on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

// URL mode: prefixing a link with the short domain (pb3p.uk/https://...) opens the
// home page with that link shortened. originalUrl keeps the link's own query string,
// and proxies may have collapsed the "//" after the scheme.
app.get(/^\/https?:/i, (req, res) => {
  const url = req.originalUrl.slice(1).replace(/^(https?):\/*/i, '$1://');
  res.redirect(`/?url=${encodeURIComponent(url)}`);
});

// Proxy mode: swapping x.com for the short domain (pb3p.uk/user/status/123) shows
// the post in phib straight away, without creating a short link.
app.get(/^\/\w+\/status\/\d+(\/video\/\d+)?\/?$/, async (req, res, next) => {
  try {
    const { url, tweet } = await resolveTweet(parseStatus(`https://x.com${req.path}`));
    res.set('Cache-Control', 'public, max-age=300');
    res.send(renderWatchPage({ target: url, tweet }));
  } catch (err) {
    if (err instanceof TwitterError) {
      return next();
    }
    next(err);
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/:code', async (req, res, next) => {
  try {
    const record = await redis.get(`url:${req.params.code}`);
    if (!record) {
      return next();
    }
    const { target, tweet } = parseRecord(record);
    // Awaited because Vercel can freeze the function as soon as the response is sent.
    await redis.incr(`clicks:${req.params.code}`).catch((err) => console.error(err));
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
