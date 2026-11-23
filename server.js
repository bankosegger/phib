require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const express = require('express');
const { nanoid } = require('nanoid');
const redis = require('./lib/redis');
const {
  parseStatus,
  resolveTweet,
  fetchReplies,
  translateTweet,
  TwitterError,
  isTwimg,
  TWEET_VERSION,
} = require('./lib/twitter');
const { parseVideo, resolveVideo, YouTubeError, VIDEO_ID } = require('./lib/youtube');
const { renderWatchPage, renderYouTubePage, renderErrorPage } = require('./lib/watch');

const PORT = process.env.PORT || 3000;
// Vercel caps function responses at 4.5 MB, so video is served in ranges up to this size.
const MEDIA_CHUNK = 4 * 1024 * 1024;
// Longer addresses are refused rather than stored.
const MAX_URL_LENGTH = 8192;
// Tolerates a full URL like https://phib.fyi/ in the env, which would otherwise
// produce https://https://... short links and break the own-domain check.
const SHORT_DOMAIN = process.env.SHORT_DOMAIN?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
// Leaving ADMIN_TOKEN unset disables the admin dashboard.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!SHORT_DOMAIN) {
  throw new Error('Missing SHORT_DOMAIN environment variable.');
}

const app = express();
app.disable('x-powered-by');
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

// The short domain counts with or without www., since one redirects to the
// other.
function bareHost(host) {
  return host.toLowerCase().replace(/^www\./, '');
}

function isOwnDomain(value) {
  return bareHost(new URL(value).host) === bareHost(SHORT_DOMAIN);
}

// Short codes are nanoid's letters, digits, _ and -. Other paths (robots.txt,
// apple-touch-icon.png, probes for wp-login.php) can't be short links, so they
// skip the Redis lookup.
function isCode(value) {
  return /^[\w-]{1,64}$/.test(value);
}

function isTweetId(value) {
  return /^\d{1,20}$/.test(value);
}

function parseRecord(record) {
  return typeof record === 'string' ? JSON.parse(record) : record;
}

// Saves a link under a new random code and returns the code. Six characters
// leave room for 68 billion codes, so a clash is rare and a few tries are
// plenty; null means they all clashed.
async function saveLink({ target, tweet, youtube }) {
  const record = { target, createdAt: new Date().toISOString(), tweet, youtube };
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nanoid(6);
    if ((await redis.set(`url:${code}`, record, { nx: true })) === 'OK') {
      return code;
    }
  }
  return null;
}

app.post('/api/shorten', async (req, res) => {
  const { url: source, twitterVideo, youtubeVideo } = req.body || {};

  if (typeof source !== 'string' || source.length > MAX_URL_LENGTH || !isValidUrl(source)) {
    return res.status(400).json({ error: 'Please provide a valid http/https URL.' });
  }

  if (isOwnDomain(source)) {
    return res.status(400).json({ error: 'That URL is already a short link from this site.' });
  }

  // Twitter/X posts and YouTube videos shown in phib are looked up first.
  const status = twitterVideo === true ? parseStatus(source) : null;
  const video = youtubeVideo === true ? parseVideo(source) : null;
  let url = source;
  let tweet;
  let youtube;
  try {
    if (status) {
      ({ url, tweet } = await resolveTweet(status));
    } else if (video) {
      ({ url, youtube } = await resolveVideo(video));
    }
  } catch (err) {
    if (err instanceof TwitterError || err instanceof YouTubeError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(502).json({
      error: `Could not look up that ${status ? 'post' : 'video'} right now. Please try again in a moment.`,
    });
  }

  try {
    const code = await saveLink({ target: url, tweet, youtube });
    if (!code) {
      return res.status(500).json({ error: 'Could not generate a unique code, please try again.' });
    }
    res.json({
      code,
      shortUrl: `https://${SHORT_DOMAIN}/${code}`,
      target: url,
      source,
      tweet,
      youtube,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/stats/:code', async (req, res) => {
  const { code } = req.params;
  if (!isCode(code)) {
    return res.status(404).json({ error: 'Short URL not found.' });
  }
  try {
    const [record, clicks] = await redis.mget(`url:${code}`, `clicks:${code}`);
    if (!record) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }
    const { target, createdAt } = parseRecord(record);
    res.json({ code, target, createdAt, clicks: Number(clicks) || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.get('/api/replies/:id', async (req, res) => {
  if (!isTweetId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tweet id.' });
  }
  const { cursor } = req.query;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[\w+/=-]{1,4096}$/.test(cursor))) {
    return res.status(400).json({ error: 'Invalid cursor.' });
  }
  try {
    const page = await fetchReplies(req.params.id, cursor);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(page);
  } catch (err) {
    if (!(err instanceof TwitterError)) {
      console.error(err);
    }
    res.status(502).json({ error: 'Could not load replies.' });
  }
});

app.get('/api/translate/:id', async (req, res) => {
  const { lang } = req.query;
  if (!isTweetId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid tweet id.' });
  }
  if (typeof lang !== 'string' || !/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(lang)) {
    return res.status(400).json({ error: 'Pass the language to translate into, like lang=en.' });
  }
  try {
    const translation = await translateTweet(req.params.id, lang.toLowerCase());
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ translation });
  } catch (err) {
    if (err instanceof TwitterError) {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    res.status(502).json({ error: 'Could not translate this post.' });
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
        body: { url: 'https://example.com', twitterVideo: 'optional boolean', youtubeVideo: 'optional boolean' },
        description: 'Shortens a URL. With twitterVideo: true, Twitter/X post links open the post in phib, pointing to its video when it has one. With youtubeVideo: true, YouTube video links open the video in phib.',
      },
      {
        method: 'GET',
        path: '/api/stats/:code',
        description: 'Target, creation date and click count of a short link.',
      },
      {
        method: 'GET',
        path: '/api/replies/:tweetId',
        query: { cursor: 'optional, the cursor of the previous page' },
        description: 'A page of the top replies of a Twitter/X post, and the cursor of the next page (null after the last one).',
      },
      {
        method: 'GET',
        path: '/api/translate/:tweetId',
        query: { lang: 'the language to translate into, like en' },
        description: 'The text of a Twitter/X post, translated.',
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
    // Keeps each Upstash request, and its answer, well under the size limit:
    // tweet links store a few kilobytes of the post each.
    for (let i = 0; i < codes.length; i += 100) {
      const batch = codes.slice(i, i + 100);
      const values = await redis.mget(...batch.flatMap((code) => [`url:${code}`, `clicks:${code}`]));
      batch.forEach((code, j) => {
        const record = values[j * 2];
        if (!record) {
          return;
        }
        const { target, createdAt, tweet, youtube } = parseRecord(record);
        links.push({
          code,
          shortUrl: `https://${SHORT_DOMAIN}/${code}`,
          target,
          createdAt,
          clicks: Number(values[j * 2 + 1]) || 0,
          tweet: tweet ? { url: tweet.url, handle: tweet.author.handle, text: tweet.text } : null,
          youtube: youtube ? { url: youtube.url, channel: youtube.author.name, title: youtube.title } : null,
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

// Fetches a Twitter media file, following redirects only while they stay on
// twimg.com, so the proxy can't be pointed anywhere else.
async function fetchTwimg(url, headers, signal) {
  let current = url;
  for (let hops = 0; hops <= 3; hops++) {
    const res = await fetch(current, { headers, signal, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) {
      return res;
    }
    await res.body?.cancel();
    current = new URL(location, current).toString();
    if (!isTwimg(current)) {
      throw new Error(`Twitter media at ${url} redirected off twimg.com, to ${current}.`);
    }
  }
  throw new Error(`Twitter media at ${url} redirected too many times.`);
}

// Twitter's pictures and videos, which load through phib because content
// blockers block twimg.com (see mediaUrl in public/post.js). Only images and
// videos are passed on, so nothing else (an HTML error page, a script) is ever
// served from phib's own address.
app.get('/media', async (req, res) => {
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

  // Gives up if Twitter hasn't started answering after 10 seconds; the
  // download itself may take as long as the reader's connection needs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let upstream;
  try {
    upstream = await fetchTwimg(url, headers, controller.signal);
  } catch (err) {
    console.error(err);
    return res.status(502).set('Cache-Control', 'no-store').end();
  } finally {
    clearTimeout(timer);
  }

  // Failures aren't cached: Vercel's CDN would otherwise keep serving a
  // passing hiccup of Twitter's for a whole day.
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !/^(?:image|video)\//i.test(type)) {
    await upstream.body?.cancel().catch(() => {});
    res.set('Cache-Control', 'no-store');
    if (upstream.status === 416 && upstream.headers.get('content-range')) {
      res.set('Content-Range', upstream.headers.get('content-range'));
    }
    return res.status(upstream.ok ? 502 : upstream.status).end();
  }

  res.status(upstream.status);
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) {
      res.set(name, value);
    }
  }
  res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  if (!upstream.body) {
    return res.end();
  }
  try {
    // Stops the download from Twitter when the reader goes away, as videos do
    // whenever they seek.
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error(err);
    }
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
// the post in phib straight away, without creating a short link. Posts that
// don't exist fall through to the 404 page.
app.get(/^\/(?:\w+|i\/web)\/status\/\d+(?:\/(?:video|photo)\/\d+)?\/?$/, async (req, res, next) => {
  try {
    const { url, tweet } = await resolveTweet(parseStatus(`https://x.com${req.path}`));
    res.set('Cache-Control', 'public, max-age=300');
    res.send(renderWatchPage({ target: url, tweet }));
  } catch (err) {
    if (err instanceof TwitterError) {
      return next();
    }
    console.error(err);
    res.status(502).send(renderErrorPage({ status: 502, message: 'Could not load this post from X right now. Please try again in a moment.' }));
  }
});

async function sendYouTube(res, next, value) {
  try {
    const { youtube } = await resolveVideo(parseVideo(value));
    res.set('Cache-Control', 'public, max-age=300');
    res.send(renderYouTubePage({ youtube }));
  } catch (err) {
    if (err instanceof YouTubeError) {
      return next();
    }
    console.error(err);
    res.status(502).send(renderErrorPage({ status: 502, message: 'Could not load this video from YouTube right now. Please try again in a moment.' }));
  }
}

// Proxy mode for YouTube: swapping youtube.com for the short domain
// (pb3p.uk/watch?v=... or pb3p.uk/shorts/...) shows the video in phib.
app.get(/^\/(watch|shorts\/[\w-]{11})\/?$/, (req, res, next) => {
  if (!parseVideo(`https://www.youtube.com${req.originalUrl}`)) {
    return next();
  }
  sendYouTube(res, next, `https://www.youtube.com${req.originalUrl}`);
});

// Links saved before the current version of the tweet details (TWEET_VERSION)
// are looked up again the first time they open, so they show everything newer
// links do: badges, link previews, every photo and video, and so on. The fresh
// details are saved back, so later opens stay a plain read, and the link keeps
// pointing where it did, with the same video or photo picked. If the post is
// gone or FxTwitter is slow, it shows as saved this time and tries again on the
// next open.
async function refreshTweet(code, record) {
  const { tweet } = record;
  try {
    // Links saved before tweet ids were stored only have the tweet url.
    const id = tweet.id || tweet.url.match(/\/status\/(\d+)/)[1];
    const { tweet: fresh } = await resolveTweet(
      { id },
      { signal: AbortSignal.timeout(3000), pick: record.target }
    );
    record.tweet = fresh;
    // xx keeps a link deleted in the meantime from coming back.
    await redis.set(`url:${code}`, record, { xx: true });
  } catch (err) {
    if (!(err instanceof TwitterError)) {
      console.error(err);
    }
  }
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/:code', async (req, res, next) => {
  const { code } = req.params;
  if (!isCode(code)) {
    return next();
  }
  try {
    const record = await redis.get(`url:${code}`);
    if (!record) {
      // Short codes are 6 characters, so an 11 character path is a youtu.be
      // link with the short domain swapped in.
      if (VIDEO_ID.test(code)) {
        return sendYouTube(res, next, `https://youtu.be${req.originalUrl}`);
      }
      return next();
    }
    const data = parseRecord(record);
    const { target, youtube } = data;
    // Awaited because Vercel can freeze the function as soon as the response is sent.
    await redis.incr(`clicks:${code}`).catch((err) => console.error(err));
    if (data.tweet) {
      if (data.tweet.v !== TWEET_VERSION) {
        await refreshTweet(code, data);
      }
      return res.send(renderWatchPage({ target, tweet: data.tweet }));
    }
    if (youtube) {
      return res.send(renderYouTubePage({ youtube }));
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

// Anything that failed unexpectedly: logged, and answered with phib's own error
// page or JSON rather than Express's default page. Bad requests, like a body
// that isn't JSON, keep their 4xx status. Express tells error handlers apart
// by their four arguments, so next stays even though it's unused.
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) {
    console.error(err);
  }
  if (res.headersSent) {
    return res.destroy();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: status === 500 ? 'Something went wrong.' : 'That request could not be read.' });
  }
  res.status(status).send(renderErrorPage({ status }));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Short URL server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
