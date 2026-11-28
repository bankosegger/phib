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
  isTwimg,
  TWEET_VERSION,
} = require('./lib/twitter');
const { parseVideo, resolveVideo, VIDEO_ID } = require('./lib/youtube');
const { parseInstagram, resolveInstagram, isInstagramCdn, isStale, BROWSER_UA } = require('./lib/instagram');
const { NotFoundError } = require('./lib/util');
const { renderWatchPage, renderYouTubePage, renderInstagramPage, renderErrorPage } = require('./lib/watch');

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

// The short domain counts with or without www., since one redirects to the other.
const SHORT_HOST = SHORT_DOMAIN.toLowerCase().replace(/^www\./, '');

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

function isOwnDomain(value) {
  return new URL(value).host.toLowerCase().replace(/^www\./, '') === SHORT_HOST;
}

// The short link of a code.
const shortUrl = (code) => `https://${SHORT_DOMAIN}/${code}`;

// Answers with a JSON error.
const jsonError = (res, status, error) => res.status(status).json({ error });

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

// Logs an unexpected failure and answers 500, so routes don't repeat it.
function serverError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

const LINK_COUNT_KEY = 'stats:links';

// How many links have been made. Redis keeps the count as links are saved, and
// the first time it's needed it starts from the links already there.
async function linkCount() {
  const count = await redis.get(LINK_COUNT_KEY);
  if (count !== null) {
    return Number(count);
  }
  const { length } = await listCodes();
  await redis.set(LINK_COUNT_KEY, length, { nx: true });
  // Another request may have started the count meanwhile.
  return Number(await redis.get(LINK_COUNT_KEY));
}

// Saves a link under a new random code and returns the code. Six characters
// leave room for 68 billion codes, so a clash is rare and a few tries are
// plenty; null means they all clashed.
async function saveLink({ target, tweet, youtube, instagram }) {
  // Before the link is saved, so a count this starts doesn't include it twice.
  // A broken count doesn't stop the link, but isn't bumped either: counting
  // up from nothing would start it again at 1.
  const counted = await linkCount().then(
    () => true,
    (err) => {
      console.error(err);
      return false;
    }
  );
  const record = { target, createdAt: new Date().toISOString(), tweet, youtube, instagram };
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nanoid(6);
    if ((await redis.set(`url:${code}`, record, { nx: true })) === 'OK') {
      if (counted) {
        await redis.incr(LINK_COUNT_KEY).catch((err) => console.error(err));
      }
      return code;
    }
  }
  return null;
}

// The lookups a shorten request can ask for, by its flag: how to read the
// pasted link, how to resolve it, and the key the details are stored under.
const LOOKUPS = [
  ['twitterVideo', parseStatus, resolveTweet, 'tweet'],
  ['youtubeVideo', parseVideo, resolveVideo, 'youtube'],
  ['instagramPost', parseInstagram, resolveInstagram, 'instagram'],
];

app.post('/api/shorten', async (req, res) => {
  const body = req.body || {};
  const source = body.url;

  if (typeof source !== 'string' || source.length > MAX_URL_LENGTH || !isValidUrl(source)) {
    return jsonError(res, 400, 'Please provide a valid http/https URL.');
  }

  if (isOwnDomain(source)) {
    return jsonError(res, 400, 'That URL is already a short link from this site.');
  }

  // Twitter/X posts, YouTube videos and Instagram posts shown in phib are
  // looked up first.
  const wanted = LOOKUPS.find(([flag, parse]) => body[flag] === true && parse(source));
  let url = source;
  const details = {};
  if (wanted) {
    const [, parse, resolve, key] = wanted;
    try {
      const result = await resolve(parse(source));
      url = result.url;
      details[key] = result[key];
    } catch (err) {
      if (err instanceof NotFoundError) {
        return jsonError(res, 400, err.message);
      }
      console.error(err);
      return jsonError(
        res,
        502,
        `Could not look up that ${key === 'youtube' ? 'video' : 'post'} right now. Please try again in a moment.`
      );
    }
  }

  try {
    const code = await saveLink({ target: url, ...details });
    if (!code) {
      return jsonError(res, 500, 'Could not generate a unique code, please try again.');
    }
    res.json({ code, shortUrl: shortUrl(code), target: url, source, ...details });
  } catch (err) {
    serverError(res, err);
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    res.json({ links: await linkCount() });
  } catch (err) {
    serverError(res, err);
  }
});

app.get('/api/stats/:code', async (req, res) => {
  const { code } = req.params;
  if (!isCode(code)) {
    return jsonError(res, 404, 'Short URL not found.');
  }
  try {
    const [record, clicks] = await redis.mget(`url:${code}`, `clicks:${code}`);
    if (!record) {
      return jsonError(res, 404, 'Short URL not found.');
    }
    const { target, createdAt } = parseRecord(record);
    res.json({ code, target, createdAt, clicks: Number(clicks) || 0 });
  } catch (err) {
    serverError(res, err);
  }
});

app.get('/api/replies/:id', async (req, res) => {
  if (!isTweetId(req.params.id)) {
    return jsonError(res, 400, 'Invalid tweet id.');
  }
  const { cursor } = req.query;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[\w+/=-]{1,4096}$/.test(cursor))) {
    return jsonError(res, 400, 'Invalid cursor.');
  }
  try {
    const page = await fetchReplies(req.params.id, cursor);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(page);
  } catch (err) {
    if (!(err instanceof NotFoundError)) {
      console.error(err);
    }
    jsonError(res, 502, 'Could not load replies.');
  }
});

app.get('/api/translate/:id', async (req, res) => {
  const { lang } = req.query;
  if (!isTweetId(req.params.id)) {
    return jsonError(res, 400, 'Invalid tweet id.');
  }
  if (typeof lang !== 'string' || !/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(lang)) {
    return jsonError(res, 400, 'Pass the language to translate into, like lang=en.');
  }
  try {
    const translation = await translateTweet(req.params.id, lang.toLowerCase());
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ translation });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return jsonError(res, 404, err.message);
    }
    console.error(err);
    jsonError(res, 502, 'Could not translate this post.');
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
        body: {
          url: 'https://example.com',
          twitterVideo: 'optional boolean',
          youtubeVideo: 'optional boolean',
          instagramPost: 'optional boolean',
        },
        description: 'Shortens a URL. With twitterVideo: true, Twitter/X post links open the post in phib, pointing to its video when it has one. With youtubeVideo: true, YouTube video links open the video in phib. With instagramPost: true, Instagram post and reel links open the post in phib, with its photos and videos to play and download.',
      },
      {
        method: 'GET',
        path: '/api/stats',
        description: 'How many links have been shortened.',
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

// What the admin list shows of a saved link: the details of its post or video
// in short, since the stored ones are a few kilobytes each.
function adminLink(code, record, clicks) {
  const { target, createdAt, tweet, youtube, instagram } = parseRecord(record);
  return {
    code,
    shortUrl: shortUrl(code),
    target,
    createdAt,
    clicks: Number(clicks) || 0,
    tweet: tweet ? { url: tweet.url, handle: tweet.author.handle, text: tweet.text } : null,
    youtube: youtube ? { url: youtube.url, channel: youtube.author.name, title: youtube.title } : null,
    instagram: instagram ? { url: instagram.url, handle: instagram.author.handle, text: instagram.text } : null,
  };
}

app.get('/api/admin/links', requireAdmin, async (req, res) => {
  try {
    const codes = await listCodes();
    const links = [];
    // Batches keep each Upstash request, and its answer, well under the size limit.
    for (let i = 0; i < codes.length; i += 100) {
      const batch = codes.slice(i, i + 100);
      const values = await redis.mget(...batch.flatMap((code) => [`url:${code}`, `clicks:${code}`]));
      batch.forEach((code, j) => {
        if (values[j * 2]) {
          links.push(adminLink(code, values[j * 2], values[j * 2 + 1]));
        }
      });
    }
    links.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ links });
  } catch (err) {
    serverError(res, err);
  }
});

app.delete('/api/admin/links/:code', requireAdmin, async (req, res) => {
  try {
    const removed = await redis.del(`url:${req.params.code}`, `clicks:${req.params.code}`);
    if (!removed) {
      return jsonError(res, 404, 'Short URL not found.');
    }
    res.status(204).end();
  } catch (err) {
    serverError(res, err);
  }
});

app.all('/api/*', (req, res) => {
  jsonError(res, 404, 'Unknown API endpoint. See /api for the list.');
});

// Whether /media loads an address: files on Twitter's (twimg.com) and
// Instagram's (cdninstagram.com, fbcdn.net) media servers, and nothing else.
function isProxiedMedia(value) {
  try {
    return typeof value === 'string' && (isTwimg(value) || isInstagramCdn(value));
  } catch {
    return false;
  }
}

// Fetches a media file, following redirects only while they stay on those
// media servers, so the proxy can't be pointed anywhere else.
async function fetchMedia(url, headers, signal) {
  let current = url;
  for (let hops = 0; hops <= 3; hops++) {
    const res = await fetch(current, { headers, signal, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!location) {
      return res;
    }
    await res.body?.cancel();
    current = new URL(location, current).toString();
    if (!isProxiedMedia(current)) {
      throw new Error(`Media at ${url} redirected off Twitter's and Instagram's media servers, to ${current}.`);
    }
  }
  throw new Error(`Media at ${url} redirected too many times.`);
}

// The Range header to ask the media server for, capped so one response stays
// under Vercel's size limit. Undefined when the request has no Range.
function mediaRange(header) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header || '');
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), start + MEDIA_CHUNK - 1) : start + MEDIA_CHUNK - 1;
  return `bytes=${start}-${end}`;
}

// Twitter's and Instagram's pictures and videos, which load through phib
// because content blockers block twimg.com and Instagram's servers refuse to
// show their files on other sites (see mediaUrl in public/post.js). Only
// images and videos are passed on, so nothing else (an HTML error page, a
// script) is ever served from phib's own address.
app.get('/media', async (req, res) => {
  const { url } = req.query;
  if (!isProxiedMedia(url)) {
    return jsonError(res, 400, 'Only Twitter and Instagram media can be loaded.');
  }

  // Instagram's servers are asked the way a browser would, as cobalt does.
  const headers = isInstagramCdn(url) ? { 'User-Agent': BROWSER_UA } : {};
  const range = mediaRange(req.get('Range'));
  if (range) {
    headers.Range = range;
  }

  // Gives up if the media server hasn't started answering after 10 seconds;
  // the download itself may take as long as the reader's connection needs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let upstream;
  try {
    upstream = await fetchMedia(url, headers, controller.signal);
  } catch (err) {
    console.error(err);
    return res.status(502).set('Cache-Control', 'no-store').end();
  } finally {
    clearTimeout(timer);
  }

  // Failures aren't cached: Vercel's CDN would otherwise keep serving a
  // passing hiccup of Twitter's or Instagram's for a whole day.
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
    // Stops the download from the media server when the reader goes away, as
    // videos do whenever they seek.
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

// Proxy mode answers: swapping a service's domain for the short domain shows
// the post or video in phib straight away, without creating a short link. One
// that doesn't exist falls through to the 404 page; a failing upstream gets
// the error page.
async function sendProxyPage(res, next, lookup, render, label) {
  try {
    const data = await lookup();
    res.set('Cache-Control', 'public, max-age=300');
    res.send(render(data));
  } catch (err) {
    if (err instanceof NotFoundError) {
      return next();
    }
    console.error(err);
    res.status(502).send(renderErrorPage({ status: 502, message: `Could not load this ${label} right now. Please try again in a moment.` }));
  }
}

// Proxy mode for Twitter/X: swapping x.com for the short domain
// (pb3p.uk/user/status/123) shows the post in phib.
app.get(/^\/(?:\w+|i\/web)\/status\/\d+(?:\/(?:video|photo)\/\d+)?\/?$/, (req, res, next) =>
  sendProxyPage(
    res,
    next,
    () => resolveTweet(parseStatus(`https://x.com${req.path}`)),
    ({ url, tweet }) => renderWatchPage({ target: url, tweet }),
    'post from X'
  )
);

// Proxy mode for YouTube: swapping youtube.com for the short domain
// (pb3p.uk/watch?v=... or pb3p.uk/shorts/...) shows the video in phib.
app.get(/^\/(watch|shorts\/[\w-]{11})\/?$/, (req, res, next) => {
  const value = `https://www.youtube.com${req.originalUrl}`;
  if (!parseVideo(value)) {
    return next();
  }
  sendProxyPage(
    res,
    next,
    () => resolveVideo(parseVideo(value)),
    ({ youtube }) => renderYouTubePage({ youtube }),
    'video from YouTube'
  );
});

// Proxy mode for Instagram: swapping instagram.com for the short domain
// (pb3p.uk/p/..., pb3p.uk/reel/..., pb3p.uk/share/...) shows the post in phib.
app.get(/^\/(?:(?:[\w.]{1,30}\/)?(?:p|reels?|tv)\/[\w-]{1,64}|share\/(?:(?:p|reels?)\/)?[\w-]{1,64})\/?$/, (req, res, next) => {
  const post = parseInstagram(`https://www.instagram.com${req.path}`);
  if (!post) {
    return next();
  }
  sendProxyPage(
    res,
    next,
    () => resolveInstagram(post),
    ({ instagram }) => renderInstagramPage({ instagram }),
    'post from Instagram'
  );
});

// Saved posts whose details are outdated (stored by an older version, see
// TWEET_VERSION and isStale) or about to expire (Instagram's media addresses
// stop working after a few days) are looked up again the first time they
// open, and the fresh details saved back — with xx, so a link deleted in the
// meantime doesn't come back. The link keeps pointing where it did, with the
// same video or photo picked. If the service doesn't answer, the saved
// details are shown and it's tried again on the next open.
async function refreshSaved(code, record, key, lookup) {
  try {
    record[key] = (await lookup())[key];
    await redis.set(`url:${code}`, record, { xx: true });
  } catch (err) {
    if (!(err instanceof NotFoundError)) {
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
        return sendProxyPage(
          res,
          next,
          () => resolveVideo(parseVideo(`https://youtu.be${req.originalUrl}`)),
          ({ youtube }) => renderYouTubePage({ youtube }),
          'video from YouTube'
        );
      }
      return next();
    }
    const data = parseRecord(record);
    const { target, youtube } = data;
    // Awaited because Vercel can freeze the function as soon as the response is sent.
    await redis.incr(`clicks:${code}`).catch((err) => console.error(err));
    if (data.tweet) {
      if (data.tweet.v !== TWEET_VERSION) {
        await refreshSaved(code, data, 'tweet', () => {
          // Links saved before tweet ids were stored only have the tweet url.
          const id = data.tweet.id || data.tweet.url.match(/\/status\/(\d+)/)[1];
          return resolveTweet({ id }, { signal: AbortSignal.timeout(3000), pick: target });
        });
      }
      return res.send(renderWatchPage({ target, tweet: data.tweet }));
    }
    if (youtube) {
      return res.send(renderYouTubePage({ youtube }));
    }
    if (data.instagram) {
      if (isStale(data.instagram)) {
        await refreshSaved(code, data, 'instagram', () =>
          resolveInstagram({ shortcode: data.instagram.shortcode }, { signal: AbortSignal.timeout(5000) })
        );
      }
      return res.send(renderInstagramPage({ instagram: data.instagram }));
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
