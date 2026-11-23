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
};
const redisPath = require.resolve('../lib/redis');
const redisModule = new Module(redisPath);
redisModule.filename = redisPath;
redisModule.loaded = true;
redisModule.exports = redis;
require.cache[redisPath] = redisModule;

const app = require('../server');

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
