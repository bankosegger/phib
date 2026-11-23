// Reading Twitter/X links and posts: lib/twitter.js, with FxTwitter and
// Twitter's embed endpoint stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStatus, richText, resolveTweet, fetchReplies, TwitterError } = require('../lib/twitter');

// Answers every request phib makes with handler(url) for the length of a test.
function stubFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => handler(String(input));
  t.after(() => {
    globalThis.fetch = original;
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// A post as FxTwitter's v2 API sends it, trimmed to what phib reads.
function fxStatus(overrides = {}) {
  return {
    type: 'status',
    id: '20',
    url: 'https://x.com/jack/status/20',
    text: 'just setting up my twttr',
    raw_text: { text: 'just setting up my twttr', display_text_range: [0, 24], facets: [] },
    author: {
      screen_name: 'jack',
      name: 'jack',
      url: 'https://x.com/jack',
      avatar_url: 'https://pbs.twimg.com/profile_images/1/jack_normal.jpg',
      verification: { verified: true, type: 'individual' },
    },
    created_timestamp: 1142974214,
    replies: 1,
    reposts: 2,
    likes: 3,
    views: 4,
    lang: 'en',
    ...overrides,
  };
}

test('parseStatus reads the post id and the picked photo or video', () => {
  assert.deepEqual(parseStatus('https://x.com/jack/status/20'), { id: '20', kind: 'video', index: 0 });
  assert.deepEqual(parseStatus('https://twitter.com/jack/status/20/photo/2'), { id: '20', kind: 'photo', index: 1 });
  assert.deepEqual(parseStatus('https://mobile.x.com/jack/status/20/video/3?s=46'), { id: '20', kind: 'video', index: 2 });
  assert.deepEqual(parseStatus('https://www.x.com/i/web/status/20'), { id: '20', kind: 'video', index: 0 });
  assert.equal(parseStatus('https://x.com/jack'), null);
  assert.equal(parseStatus('https://example.com/jack/status/20'), null);
});

test('richText shortens links the way x.com shows them', () => {
  // Sentence punctuation isn't part of the link, and long links are cut short.
  assert.deepEqual(richText('Read https://example.com/a/very/long/path/that/goes/on/and/on. Then sleep.', []), {
    text: 'Read example.com/a/very/long/path/…. Then sleep.',
    links: [{ start: 5, end: 35, url: 'https://example.com/a/very/long/path/that/goes/on/and/on' }],
  });
  // FxTwitter's display form wins.
  const facets = [{ type: 'url', replacement: 'https://example.com/article', display: 'example.com/article' }];
  assert.deepEqual(richText('Read https://example.com/article', facets), {
    text: 'Read example.com/article',
    links: [{ start: 5, end: 24, url: 'https://example.com/article' }],
  });
  // A bracket the link opened stays part of it.
  assert.equal(
    richText('(see https://en.wikipedia.org/wiki/Foo_(bar))', []).links[0].url,
    'https://en.wikipedia.org/wiki/Foo_(bar)'
  );
});

test('richText links mentions, hashtags and cashtags', () => {
  assert.deepEqual(richText('Hi @phib, see #news and $TSLA (not a@b.com) #123', []), {
    text: 'Hi @phib, see #news and $TSLA (not a@b.com) #123',
    links: [
      { start: 3, end: 8, url: 'https://x.com/phib' },
      { start: 14, end: 19, url: 'https://x.com/hashtag/news' },
      { start: 24, end: 29, url: 'https://x.com/search?q=%24TSLA' },
    ],
  });
});

test('richText leaves out what x.com hides', () => {
  // The @mentions a reply starts with, with or without Twitter's display range.
  assert.deepEqual(richText('@jack @durov hello there', [], { reply: true, displayStart: 12 }), { text: 'hello there', links: undefined });
  assert.deepEqual(richText('@jack hello', [], { reply: true }), { text: 'hello', links: undefined });
  // The link to the quoted post, which shows as a box instead.
  assert.deepEqual(richText('so true https://x.com/jack/status/20', [], { quoteId: '20' }), { text: 'so true', links: undefined });
  assert.deepEqual(richText(undefined, undefined), { text: '', links: undefined });
});

test('resolveTweet keeps what x.com shows of a post', async (t) => {
  stubFetch(t, (url) =>
    url === 'https://api.fxtwitter.com/2/status/20' ? json({ code: 200, status: fxStatus() }) : new Response('', { status: 404 })
  );
  const { url, tweet } = await resolveTweet({ id: '20' });
  assert.equal(url, 'https://x.com/jack/status/20');
  assert.equal(tweet.text, 'just setting up my twttr');
  assert.equal(tweet.author.verified, 'blue');
  assert.equal(tweet.createdAt, '2006-03-21T20:50:14.000Z');
  assert.deepEqual(tweet.stats, { replies: 1, retweets: 2, likes: 3, views: 4, quotes: undefined, bookmarks: undefined });
});

test('resolveTweet tells a missing post apart from FxTwitter failing', async (t) => {
  let status = 404;
  stubFetch(t, (url) => (url.includes('fxtwitter') ? json({ code: status }, status) : new Response('', { status: 404 })));
  await assert.rejects(resolveTweet({ id: '1999999999999999999' }), TwitterError);
  status = 503;
  await assert.rejects(resolveTweet({ id: '1999999999999999999' }), (err) => !(err instanceof TwitterError));
});

test('resolveTweet copes with a post missing its time or a proper address', async (t) => {
  const odd = fxStatus({ url: 'javascript:alert(1)', created_timestamp: undefined });
  stubFetch(t, (url) => (url.includes('fxtwitter') ? json({ code: 200, status: odd }) : new Response('', { status: 404 })));
  const { tweet } = await resolveTweet({ id: '20' });
  assert.equal(tweet.url, 'https://x.com/jack/status/20');
  assert.equal(tweet.createdAt, undefined);
});

test('fetchReplies skips deleted replies and copes with odd ones', async (t) => {
  const reply = fxStatus({
    id: '21',
    url: 'javascript:alert(1)',
    created_timestamp: undefined,
    replying_to: { screen_name: 'jack', status: '20' },
  });
  stubFetch(t, (url) =>
    url.startsWith('https://api.fxtwitter.com/2/conversation/20')
      ? json({ code: 200, replies: [reply, { id: '22' }], cursor: { bottom: 'next-page' } })
      : new Response('', { status: 404 })
  );
  const page = await fetchReplies('20');
  assert.equal(page.replies.length, 1);
  assert.equal(page.replies[0].url, 'https://x.com/jack/status/21');
  assert.equal(page.replies[0].createdAt, undefined);
  assert.equal(page.replies[0].parentId, '20');
  assert.equal(page.cursor, 'next-page');
});
