// Reading Instagram links and looking posts up: lib/instagram.js, with
// Instagram's mobile API, embed page and GraphQL API stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseInstagram,
  resolveInstagram,
  captionLinks,
  isInstagramCdn,
  isStale,
  InstagramError,
  INSTAGRAM_VERSION,
} = require('../lib/instagram');

// The tests decide when there's a session cookie.
delete process.env.INSTAGRAM_COOKIE;

// Answers every request with handler(url, init) for the length of a test, and
// returns the requests made.
function stubFetch(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Instagram's media addresses, signed to expire in three days.
const expires = Math.floor(Date.now() / 1000) + 3 * 86400;
function cdn(name) {
  return `https://scontent-vie1-1.cdninstagram.com/v/t51.2885-15/${name}?stp=dst-jpg_e35&_nc_ht=scontent-vie1-1.cdninstagram.com&oh=00_AbC&oe=${expires.toString(16)}`;
}

// A post as the mobile API sends it, trimmed to what phib reads: a photo and a
// video side by side.
function apiPost(overrides = {}) {
  return {
    code: 'C8abcDEFgh1',
    media_type: 8,
    product_type: 'carousel_container',
    taken_at: 1764000000,
    user: { username: 'natgeo', full_name: 'National Geographic', is_verified: true, profile_pic_url: cdn('avatar.jpg') },
    caption: { text: 'Look at this, @nat.geo. #wildlife <3' },
    like_count: 12345,
    comment_count: 67,
    carousel_media: [
      {
        media_type: 1,
        original_width: 1080,
        original_height: 1350,
        image_versions2: {
          candidates: [
            { width: 640, height: 800, url: cdn('small.jpg') },
            { width: 1080, height: 1350, url: cdn('fox.jpg') },
          ],
        },
        accessibility_caption: 'A fox in the snow',
      },
      {
        media_type: 2,
        original_width: 1080,
        original_height: 1920,
        image_versions2: { candidates: [{ width: 1080, height: 1920, url: cdn('cover.jpg') }] },
        video_versions: [
          { width: 480, height: 854, url: cdn('low.mp4') },
          { width: 720, height: 1280, url: cdn('high.mp4') },
        ],
        video_duration: 12.5,
      },
    ],
    location: { name: 'Yellowstone' },
    ...overrides,
  };
}

// A reel as the web app's GraphQL API and the embed page send it.
function graphReel(overrides = {}) {
  return {
    __typename: 'XDTGraphVideo',
    shortcode: 'C9reelCODE1',
    product_type: 'clips',
    is_video: true,
    video_url: cdn('reel.mp4'),
    display_url: cdn('reel-cover.jpg'),
    dimensions: { width: 1080, height: 1920 },
    video_duration: 30.1,
    video_play_count: 999999,
    taken_at_timestamp: 1764000000,
    owner: { username: 'someone_', full_name: '', is_verified: false, profile_pic_url: cdn('someone.jpg') },
    edge_media_to_caption: { edges: [{ node: { text: 'A reel' } }] },
    edge_media_preview_like: { count: 10 },
    edge_media_to_parent_comment: { count: 2 },
    ...overrides,
  };
}

const isOembed = (url) => url.startsWith('https://i.instagram.com/api/v1/oembed/');

test('parseInstagram reads posts, reels and share links', () => {
  const post = { shortcode: 'C8abcDEFgh1' };
  assert.deepEqual(parseInstagram('https://www.instagram.com/p/C8abcDEFgh1/'), post);
  assert.deepEqual(parseInstagram('https://instagram.com/reel/C8abcDEFgh1/?igsh=MWQ1ZGUxMzBkMA=='), post);
  assert.deepEqual(parseInstagram('https://www.instagram.com/reels/C8abcDEFgh1'), post);
  assert.deepEqual(parseInstagram('https://www.instagram.com/natgeo/p/C8abcDEFgh1/?img_index=2'), post);
  assert.deepEqual(parseInstagram('https://www.instagram.com/tv/C8abcDEFgh1/embed/'), post);
  assert.deepEqual(parseInstagram('https://instagr.am/p/C8abcDEFgh1/'), post);
  assert.deepEqual(parseInstagram('https://d.ddinstagram.com/reel/C8abcDEFgh1/'), post);
  assert.deepEqual(parseInstagram('https://www.instagram.com/share/reel/BAAkn3Hmzc/'), { share: 'BAAkn3Hmzc' });
  assert.deepEqual(parseInstagram('https://www.instagram.com/share/_aBc-123/'), { share: '_aBc-123' });
  for (const url of [
    'https://www.instagram.com/natgeo/',
    'https://www.instagram.com/stories/natgeo/3400000000000000001/',
    'https://www.instagram.com/reels/audio/123456789/',
    'https://www.instagram.com/explore/tags/cats/',
    'https://example.com/p/C8abcDEFgh1/',
  ]) {
    assert.equal(parseInstagram(url), null, url);
  }
});

test("isInstagramCdn only allows https files on Instagram's media servers", () => {
  assert.equal(isInstagramCdn('https://scontent-vie1-1.cdninstagram.com/v/x.jpg'), true);
  assert.equal(isInstagramCdn('https://instagram.fvie1-1.fna.fbcdn.net/v/x.mp4'), true);
  assert.equal(isInstagramCdn('http://scontent.cdninstagram.com/v/x.jpg'), false);
  assert.equal(isInstagramCdn('https://fbcdn.net.evil.example/x.jpg'), false);
  assert.equal(isInstagramCdn('https://evilcdninstagram.com/x.jpg'), false);
});

test('captionLinks links mentions and hashtags the way instagram.com does', () => {
  assert.deepEqual(captionLinks('Hi @nat.geo. #cats #2024 me@example.com https://example.com'), [
    { start: 3, end: 11, url: 'https://www.instagram.com/nat.geo/' },
    { start: 13, end: 18, url: 'https://www.instagram.com/explore/tags/cats/' },
  ]);
  assert.equal(captionLinks('nothing to link'), undefined);
});

test('resolveInstagram reads a post with several photos and videos from the mobile API', async (t) => {
  const calls = stubFetch(t, (url) => {
    if (isOembed(url)) {
      return json({ media_id: '3400000000000000001_787132' });
    }
    if (url === 'https://i.instagram.com/api/v1/media/3400000000000000001_787132/info/') {
      return json({ items: [apiPost()] });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  const { url, instagram } = await resolveInstagram({ shortcode: 'C8abcDEFgh1' });
  assert.equal(url, 'https://www.instagram.com/p/C8abcDEFgh1/');
  assert.equal(new URL(calls[0].url).searchParams.get('url'), 'https://www.instagram.com/p/C8abcDEFgh1/');
  assert.match(calls[0].init.headers['User-Agent'], /^Instagram \d/);

  // As it's stored, without the fields that aren't there.
  assert.deepEqual(JSON.parse(JSON.stringify(instagram)), {
    v: INSTAGRAM_VERSION,
    shortcode: 'C8abcDEFgh1',
    url: 'https://www.instagram.com/p/C8abcDEFgh1/',
    text: 'Look at this, @nat.geo. #wildlife <3',
    links: [
      { start: 14, end: 22, url: 'https://www.instagram.com/nat.geo/' },
      { start: 24, end: 33, url: 'https://www.instagram.com/explore/tags/wildlife/' },
    ],
    createdAt: '2025-11-24T16:00:00.000Z',
    author: {
      name: 'National Geographic',
      handle: 'natgeo',
      avatar: cdn('avatar.jpg'),
      url: 'https://www.instagram.com/natgeo/',
      verified: 'blue',
    },
    location: 'Yellowstone',
    stats: { likes: 12345, comments: 67 },
    media: [
      { type: 'photo', url: cdn('fox.jpg'), width: 1080, height: 1350, alt: 'A fox in the snow' },
      { type: 'video', url: cdn('high.mp4'), thumbnail: cdn('cover.jpg'), duration: 12.5, width: 1080, height: 1920 },
    ],
    expires: new Date(expires * 1000).toISOString(),
  });
});

test("resolveInstagram keeps only addresses on Instagram's media servers", async (t) => {
  let post = apiPost({ user: { username: 'natgeo', profile_pic_url: 'javascript:alert(1)' } });
  stubFetch(t, (url) => {
    if (isOembed(url)) {
      return json({ media_id: '1_2' });
    }
    if (url.includes('/api/v1/media/1_2/info/')) {
      return json({ items: [post] });
    }
    return new Response('Not here', { status: 403 });
  });

  const { instagram } = await resolveInstagram({ shortcode: 'C8abcDEFgh1' });
  assert.equal(instagram.author.avatar, undefined);
  assert.equal(instagram.author.verified, null);
  assert.equal(instagram.author.name, 'natgeo');

  // A post whose media aren't on Instagram's servers isn't shown at all.
  post = apiPost({
    carousel_media: undefined,
    media_type: 1,
    image_versions2: { candidates: [{ width: 1, height: 1, url: 'https://evil.example/x.jpg' }] },
  });
  await assert.rejects(resolveInstagram({ shortcode: 'C8abcDEFgh1' }), (err) => {
    assert.ok(!(err instanceof InstagramError));
    assert.match(err.message, /mobile API: the post came without its media/);
    return true;
  });
});

test('resolveInstagram falls back to the embed page', async (t) => {
  const context = JSON.stringify({ gql_data: { shortcode_media: graphReel({ __typename: 'GraphVideo' }) } });
  const html = `<script>(new ServerJS()).handle({"require":[["EmbedSimple","init",[],[${JSON.stringify({ contextJSON: context })}]],["Other","run",[],[]]]});</script>`;
  stubFetch(t, (url) => {
    if (url.startsWith('https://i.instagram.com/')) {
      return json({ message: 'login_required', status: 'fail' }, 403);
    }
    if (url === 'https://www.instagram.com/p/C9reelCODE1/embed/captioned/') {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  const { url, instagram } = await resolveInstagram({ shortcode: 'C9reelCODE1' });
  assert.equal(url, 'https://www.instagram.com/reel/C9reelCODE1/');
  // Accounts without a name go by their username.
  assert.equal(instagram.author.name, 'someone_');
  assert.deepEqual(instagram.stats, { likes: 10, comments: 2, views: 999999 });
  assert.deepEqual(instagram.media, [
    {
      type: 'video',
      url: cdn('reel.mp4'),
      thumbnail: cdn('reel-cover.jpg'),
      duration: 30.1,
      width: 1080,
      height: 1920,
      alt: undefined,
    },
  ]);
});

test("resolveInstagram falls back to the GraphQL API, with the tokens of the post's page", async (t) => {
  const page =
    '<script>["LSD",[],{"token":"AVpage-lsd"},323],["InstagramSecurityConfig",[],{"csrf_token":"page-csrf"},4],["PolarisSiteData",[],{"device_id":"DEV-1","machine_id":"MID-1"},5]</script>';
  let query;
  stubFetch(t, (url, init) => {
    if (url.startsWith('https://i.instagram.com/')) {
      return json({ message: 'login_required', status: 'fail' }, 403);
    }
    if (url.endsWith('/embed/captioned/')) {
      return new Response('<html>Nothing in here</html>', { status: 200 });
    }
    if (url === 'https://www.instagram.com/p/C9reelCODE1/') {
      return new Response(page, { status: 200 });
    }
    if (url === 'https://www.instagram.com/graphql/query') {
      query = init;
      return json({ data: { xdt_shortcode_media: graphReel() }, status: 'ok' });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  const { instagram } = await resolveInstagram({ shortcode: 'C9reelCODE1' });
  assert.equal(instagram.media[0].url, cdn('reel.mp4'));
  assert.equal(query.method, 'POST');
  assert.equal(query.headers['X-FB-LSD'], 'AVpage-lsd');
  assert.equal(query.headers['X-CSRFToken'], 'page-csrf');
  assert.match(query.headers.Cookie, /^csrftoken=page-csrf; ig_did=DEV-1; .*mid=MID-1/);
  const body = new URLSearchParams(query.body);
  assert.equal(body.get('doc_id'), '8845758582119845');
  assert.equal(body.get('lsd'), 'AVpage-lsd');
  assert.equal(JSON.parse(body.get('variables')).shortcode, 'C9reelCODE1');
});

test('resolveInstagram tells a missing post apart from Instagram turning phib away', async (t) => {
  let blocked = false;
  stubFetch(t, (url) => {
    if (blocked) {
      return new Response('Please wait a few minutes before you try again.', { status: 429 });
    }
    if (isOembed(url)) {
      return json({ message: 'No media match' }, 404);
    }
    if (url === 'https://www.instagram.com/graphql/query') {
      return json({ data: { xdt_shortcode_media: null }, status: 'ok' });
    }
    return new Response('<html></html>', { status: 200 });
  });
  await assert.rejects(resolveInstagram({ shortcode: 'C8gone00000' }), InstagramError);

  // The error lists what each way of looking the post up got, for the logs.
  blocked = true;
  await assert.rejects(resolveInstagram({ shortcode: 'C8abcDEFgh1' }), (err) => {
    assert.ok(!(err instanceof InstagramError));
    assert.match(err.message, /mobile API: oEmbed answered 429; embed page: answered 429 without the post; GraphQL: answered 429/);
    return true;
  });
});

test('resolveInstagram tries each way again with the session cookie in INSTAGRAM_COOKIE', async (t) => {
  process.env.INSTAGRAM_COOKIE = 'sessionid=abc; csrftoken=tok';
  t.after(() => {
    delete process.env.INSTAGRAM_COOKIE;
  });
  const calls = stubFetch(t, (url, init) => {
    if (isOembed(url)) {
      return init.headers.Cookie ? json({ media_id: '1_2' }) : json({ message: 'login_required' }, 403);
    }
    if (url === 'https://i.instagram.com/api/v1/media/1_2/info/') {
      return json({ items: [apiPost()] });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  const { instagram } = await resolveInstagram({ shortcode: 'C8abcDEFgh1' });
  assert.equal(instagram.shortcode, 'C8abcDEFgh1');
  assert.deepEqual(
    calls.map((call) => call.init.headers.Cookie),
    [undefined, 'sessionid=abc; csrftoken=tok', 'sessionid=abc; csrftoken=tok']
  );
});

test('resolveInstagram follows share links to their post', async (t) => {
  const reel = apiPost({
    code: 'C9reelCODE1',
    media_type: 2,
    product_type: 'clips',
    carousel_media: undefined,
    image_versions2: { candidates: [{ width: 1080, height: 1920, url: cdn('cover.jpg') }] },
    video_versions: [{ width: 1080, height: 1920, url: cdn('reel.mp4') }],
  });
  let share = () =>
    new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/reel/C9reelCODE1/?igsh=abc' } });
  const calls = stubFetch(t, (url) => {
    if (url === 'https://www.instagram.com/share/BAAkn3Hmzc/') {
      return share();
    }
    if (isOembed(url)) {
      return json({ media_id: '5_6' });
    }
    if (url === 'https://i.instagram.com/api/v1/media/5_6/info/') {
      return json({ items: [reel] });
    }
    throw new Error(`Unexpected request to ${url}`);
  });

  const { url } = await resolveInstagram(parseInstagram('https://www.instagram.com/share/reel/BAAkn3Hmzc/'));
  assert.equal(url, 'https://www.instagram.com/reel/C9reelCODE1/');
  assert.equal(calls[0].init.headers['User-Agent'], 'curl/7.88.1');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(new URL(calls[1].url).searchParams.get('url'), 'https://www.instagram.com/p/C9reelCODE1/');

  // Sent to log in, phib was turned away; sent nowhere, the link leads nowhere.
  share = () => new Response(null, { status: 302, headers: { location: '/accounts/login/?next=%2Fshare%2F' } });
  await assert.rejects(resolveInstagram({ share: 'BAAkn3Hmzc' }), (err) => !(err instanceof InstagramError));
  share = () => new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/' } });
  await assert.rejects(resolveInstagram({ share: 'BAAkn3Hmzc' }), InstagramError);
});

test('isStale asks for a fresh look before the media addresses expire', () => {
  const inAWhile = (ms) => new Date(Date.now() + ms).toISOString();
  assert.equal(isStale({ v: INSTAGRAM_VERSION, expires: inAWhile(2 * 60 * 60 * 1000) }), false);
  assert.equal(isStale({ v: INSTAGRAM_VERSION, expires: inAWhile(10 * 60 * 1000) }), true);
  assert.equal(isStale({ v: INSTAGRAM_VERSION - 1, expires: inAWhile(2 * 60 * 60 * 1000) }), true);
  assert.equal(isStale({ v: INSTAGRAM_VERSION }), true);
});
