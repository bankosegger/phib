// The routes in server.js, run against an in-memory stand-in for Redis and
// stubbed upstreams (FxTwitter, Twitter's media and embed hosts), so the tests
// never touch the real database or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.SHORT_DOMAIN = 'phib.test';
process.env.ADMIN_TOKEN = 'test-admin-token';

const store = new Map();
const redisCalls = [];
const redis = {
  async get(key) {
    redisCalls.push(key);
    return store.has(key) ? structuredClone(store.get(key)) : null;
  },
  async set(key, value, { nx, xx } = {}) {
    if ((nx && store.has(key)) || (xx && !store.has(key))) {
      return null;
    }
    store.set(key, structuredClone(value));
    return 'OK';
  },
  async incr(key) {
    store.set(key, (store.get(key) || 0) + 1);
    return store.get(key);
  },
  async mget(...keys) {
    return keys.map((key) => (store.has(key) ? structuredClone(store.get(key)) : null));
  },
  // All matching keys in one go, where Redis pages through them.
  async scan(cursor, { match }) {
    const prefix = match.replace(/\*$/, '');
    return ['0', [...store.keys()].filter((key) => key.startsWith(prefix))];
  },
};
const redisPath = require.resolve('../lib/redis');
const redisModule = new Module(redisPath);
redisModule.filename = redisPath;
redisModule.loaded = true;
redisModule.exports = redis;
require.cache[redisPath] = redisModule;

const app = require('../server');

// Even if the .env that server.js loads has a session cookie, the tests run
// without one.
delete process.env.INSTAGRAM_COOKIE;

// Requests to the test server go through; everything else goes to upstream,
// which each test sets.
let base;
let upstream;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input);
  return url.startsWith(base) ? realFetch(input, init) : upstream(url, init);
};

let server;
test.before(async () => {
  // The server logs the upstream failures these tests cause on purpose.
  test.mock.method(console, 'error', () => {});
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  globalThis.fetch = realFetch;
  test.mock.restoreAll();
});
test.beforeEach(() => {
  upstream = (url) => {
    throw new Error(`Unexpected request to ${url}`);
  };
});

function shorten(body) {
  return fetch(`${base}/api/shorten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mediaUrl(url) {
  return `${base}/media?url=${encodeURIComponent(url)}`;
}

test('shortens a link and redirects to it, counting the click', async () => {
  const res = await shorten({ url: 'https://example.com/some/page?q=1' });
  assert.equal(res.status, 200);
  const { code, shortUrl, target } = await res.json();
  assert.match(code, /^[\w-]{6}$/);
  assert.equal(shortUrl, `https://phib.test/${code}`);
  assert.equal(target, 'https://example.com/some/page?q=1');

  const open = await fetch(`${base}/${code}`, { redirect: 'manual' });
  assert.equal(open.status, 302);
  assert.equal(open.headers.get('location'), 'https://example.com/some/page?q=1');
  assert.equal(open.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(store.get(`clicks:${code}`), 1);
  assert.equal(open.headers.get('x-powered-by'), null);
});

function savedLinks() {
  return [...store.keys()].filter((key) => key.startsWith('url:')).length;
}

async function fetchLinkCount() {
  const res = await fetch(`${base}/api/stats`);
  assert.equal(res.status, 200);
  return (await res.json()).links;
}

test('counts the links made, starting from the ones already saved', async () => {
  await shorten({ url: 'https://example.com/before-counting' });
  store.delete('stats:links');
  const saved = savedLinks();
  assert.ok(saved > 0);
  assert.equal(await fetchLinkCount(), saved);

  await shorten({ url: 'https://example.com/counted' });
  await shorten({ url: 'https://example.com/counted-too' });
  assert.equal(await fetchLinkCount(), saved + 2);

  // Links that aren't made don't count.
  await shorten({ url: 'ftp://example.com/file' });
  assert.equal(await fetchLinkCount(), saved + 2);
});

test('a link that starts the count is counted once', async () => {
  store.delete('stats:links');
  const res = await shorten({ url: 'https://example.com/starts-the-count' });
  assert.equal(res.status, 200);
  assert.equal(await fetchLinkCount(), savedLinks());
});

test('refuses what is not a single http(s) address, or already a short link', async () => {
  for (const url of [
    ['https://example.com'],
    { href: 'https://example.com' },
    'ftp://example.com/file',
    `https://example.com/${'a'.repeat(8200)}`,
    'https://phib.test/abc123',
    'https://www.phib.test/abc123',
  ]) {
    const res = await shorten({ url });
    assert.equal(res.status, 400, JSON.stringify(url).slice(0, 60));
  }
});

test('answers a body that is not JSON with a JSON error', async () => {
  const res = await fetch(`${base}/api/shorten`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test('says to try again when FxTwitter is failing, and not found when the post is missing', async () => {
  upstream = (url) => new Response('{}', { status: url.includes('fxtwitter') ? 503 : 404 });
  let res = await shorten({ url: 'https://x.com/jack/status/20', twitterVideo: true });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /try again/);

  res = await fetch(`${base}/jack/status/20`);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Could not load this post from X right now/);

  upstream = () => new Response('{"code":404}', { status: 404 });
  res = await fetch(`${base}/jack/status/20`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /doesn't exist/);
});

test('paths that cannot be codes skip Redis', async () => {
  redisCalls.length = 0;
  for (const path of ['/robots.txt', '/wp-login.php', '/apple-touch-icon.png']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404);
  }
  assert.deepEqual(redisCalls, []);
});

test('the media proxy only loads Twitter media', async () => {
  const res = await fetch(mediaUrl('https://example.com/cat.jpg'));
  assert.equal(res.status, 400);
});

test('the media proxy passes pictures on, cached, and asks for videos in chunks', async () => {
  let asked;
  upstream = (url, init) => {
    asked = init.headers;
    return new Response('fake jpeg', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '9' } });
  };
  const res = await fetch(mediaUrl('https://pbs.twimg.com/media/abc.jpg'), { headers: { Range: 'bytes=0-' } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'fake jpeg');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(asked.Range, `bytes=0-${4 * 1024 * 1024 - 1}`);
});

test('the media proxy never caches failures or serves anything but media', async () => {
  upstream = () => new Response('gone', { status: 404 });
  let res = await fetch(mediaUrl('https://pbs.twimg.com/media/missing.jpg'));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), '');

  upstream = () => new Response('<script>alert(1)</script>', { status: 200, headers: { 'content-type': 'text/html' } });
  res = await fetch(mediaUrl('https://pbs.twimg.com/media/page.jpg'));
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), '');
});

test('the media proxy follows redirects only within twimg.com', async () => {
  upstream = (url) =>
    url.includes('/old/')
      ? new Response(null, { status: 302, headers: { location: 'https://pbs.twimg.com/media/new.jpg' } })
      : new Response('moved', { status: 200, headers: { 'content-type': 'image/jpeg' } });
  let res = await fetch(mediaUrl('https://pbs.twimg.com/old/new.jpg'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'moved');

  upstream = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/page.html' } });
  res = await fetch(mediaUrl('https://pbs.twimg.com/media/redirect.jpg'));
  assert.equal(res.status, 502);
});

// Instagram ---------------------------------------------------------------------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// An Instagram media address, signed to expire in three days.
const igExpires = Math.floor(Date.now() / 1000) + 3 * 86400;
function igMedia(name) {
  return `https://scontent-vie1-1.cdninstagram.com/v/t51.2885-15/${name}?_nc_ht=scontent-vie1-1.cdninstagram.com&oh=00_AbC&oe=${igExpires.toString(16)}`;
}

// A reel as Instagram's mobile API sends it.
function igReel(shortcode) {
  return {
    code: shortcode,
    media_type: 2,
    product_type: 'clips',
    taken_at: 1764000000,
    user: { username: 'someone', full_name: 'Some One', profile_pic_url: igMedia('avatar.jpg') },
    caption: { text: 'A <reel>' },
    image_versions2: { candidates: [{ width: 1080, height: 1920, url: igMedia('cover.jpg') }] },
    video_versions: [{ width: 1080, height: 1920, url: igMedia('reel.mp4') }],
    like_count: 5,
    comment_count: 1,
    play_count: 100,
  };
}

// Instagram with the given posts, by shortcode: its mobile API knows them, and
// its GraphQL API says any other post doesn't exist.
function instagramWith(posts) {
  const codes = Object.keys(posts);
  return (url) => {
    if (url.startsWith('https://i.instagram.com/api/v1/oembed/')) {
      const index = codes.indexOf(new URL(url).searchParams.get('url').split('/')[4]);
      return index >= 0 ? json({ media_id: `${index + 1}_7` }) : json({ message: 'No media match' }, 404);
    }
    const info = url.match(/\/api\/v1\/media\/(\d+)_7\/info\/$/);
    if (info) {
      return json({ items: [posts[codes[info[1] - 1]]] });
    }
    if (url === 'https://www.instagram.com/graphql/query') {
      return json({ data: { xdt_shortcode_media: null }, status: 'ok' });
    }
    return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
}

test('opens Instagram posts in phib, and looks them up again before their media expire', async () => {
  upstream = instagramWith({ C9reelCODE1: igReel('C9reelCODE1') });
  const res = await shorten({ url: 'https://www.instagram.com/reel/C9reelCODE1/?igsh=abc', instagramPost: true });
  assert.equal(res.status, 200);
  const { code, target, instagram } = await res.json();
  assert.equal(target, 'https://www.instagram.com/reel/C9reelCODE1/');
  assert.equal(instagram.author.handle, 'someone');
  assert.equal(instagram.media[0].url, igMedia('reel.mp4'));

  // While the media addresses work, opening the link is a plain read.
  let asked = 0;
  upstream = (url) => {
    asked += 1;
    return instagramWith({ C9reelCODE1: igReel('C9reelCODE1') })(url);
  };
  let page = await fetch(`${base}/${code}`);
  assert.equal(page.status, 200);
  let html = await page.text();
  assert.equal(asked, 0);
  assert.match(html, /<video class="tweet-video" src="\/media\?url=https%3A%2F%2Fscontent-vie1-1\.cdninstagram\.com/);
  assert.match(html, /A &lt;reel&gt;/);
  assert.match(html, /<meta property="og:video" content="https:\/\/scontent-vie1-1\.cdninstagram\.com\//);
  assert.match(html, /download="instagram_C9reelCODE1\.mp4"/);
  assert.match(html, /<script src="\/instagram\.js"><\/script>/);

  // Once they're about to expire, the post is looked up again and saved back.
  const record = store.get(`url:${code}`);
  record.instagram.expires = new Date(Date.now() + 60 * 1000).toISOString();
  record.instagram.media[0].url = 'https://scontent-vie1-1.cdninstagram.com/v/old.mp4';
  store.set(`url:${code}`, record);
  page = await fetch(`${base}/${code}`);
  html = await page.text();
  assert.ok(asked > 0);
  assert.doesNotMatch(html, /old\.mp4/);
  const saved = store.get(`url:${code}`).instagram;
  assert.equal(saved.media[0].url, igMedia('reel.mp4'));
  assert.ok(Date.parse(saved.expires) > Date.now() + 24 * 60 * 60 * 1000);
});

test('proxy mode shows Instagram posts, and says when they are missing or Instagram is failing', async () => {
  upstream = instagramWith({ C9reelCODE1: igReel('C9reelCODE1') });
  let res = await fetch(`${base}/someone/reel/C9reelCODE1/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.match(await res.text(), /View on Instagram/);

  res = await fetch(`${base}/p/C8missing00`);
  assert.equal(res.status, 404);

  upstream = () => new Response('Please wait a few minutes before you try again.', { status: 429 });
  res = await fetch(`${base}/p/C9reelCODE1`);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Could not load this post from Instagram right now/);
});

test('the media proxy loads Instagram media too, asking the way a browser does', async () => {
  let asked;
  upstream = (url, init) => {
    asked = init.headers;
    return new Response('fake mp4', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-7/8' },
    });
  };
  let res = await fetch(mediaUrl('https://instagram.fvie1-1.fna.fbcdn.net/v/clip.mp4?oe=1&oh=2'), {
    headers: { Range: 'bytes=0-' },
  });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), 'fake mp4');
  assert.match(asked['User-Agent'], /Chrome\//);
  assert.equal(asked.Range, `bytes=0-${4 * 1024 * 1024 - 1}`);

  res = await fetch(mediaUrl('https://fbcdn.net.evil.example/clip.mp4'));
  assert.equal(res.status, 400);
});
