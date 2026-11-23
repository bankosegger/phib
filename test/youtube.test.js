// Reading YouTube links and looking videos up: lib/youtube.js, with YouTube's
// oEmbed endpoint stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVideo, resolveVideo, YouTubeError } = require('../lib/youtube');

function stubFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => handler(String(input));
  t.after(() => {
    globalThis.fetch = original;
  });
}

test('parseVideo reads watch, youtu.be and Shorts links with their start time', () => {
  assert.deepEqual(parseVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', start: 0, short: false });
  assert.deepEqual(parseVideo('https://youtu.be/dQw4w9WgXcQ?t=1m30s'), { id: 'dQw4w9WgXcQ', start: 90, short: false });
  assert.deepEqual(parseVideo('https://m.youtube.com/watch?v=dQw4w9WgXcQ&start=42'), { id: 'dQw4w9WgXcQ', start: 42, short: false });
  assert.deepEqual(parseVideo('https://youtube.com/shorts/dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', start: 0, short: true });
  assert.equal(parseVideo('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(parseVideo('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('resolveVideo tells a missing video apart from YouTube failing', async (t) => {
  let status = 404;
  stubFetch(t, () => new Response('Not Found', { status }));
  await assert.rejects(resolveVideo({ id: 'dQw4w9WgXcQ', start: 0 }), YouTubeError);
  status = 503;
  await assert.rejects(resolveVideo({ id: 'dQw4w9WgXcQ', start: 0 }), (err) => !(err instanceof YouTubeError));
});

test('resolveVideo only keeps https addresses from oEmbed', async (t) => {
  stubFetch(
    t,
    () =>
      new Response(JSON.stringify({ title: 'A video', author_name: 'Someone', author_url: 'javascript:alert(1)' }), {
        status: 200,
      })
  );
  const { url, youtube } = await resolveVideo({ id: 'dQw4w9WgXcQ', start: 90 });
  assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s');
  assert.equal(youtube.author.url, undefined);
  assert.equal(youtube.thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});
