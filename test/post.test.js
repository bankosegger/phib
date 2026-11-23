// Rendering posts: public/post.js, which the server and the browser share.
const test = require('node:test');
const assert = require('node:assert/strict');
const PhibPost = require('../public/post');

// A post as lib/twitter.js stores it.
const tweet = {
  v: 2,
  id: '2124638954272305593',
  url: 'https://x.com/durov/status/2124638954272305593',
  text: 'Hello <world> & @jack',
  links: [{ start: 16, end: 21, url: 'https://x.com/jack' }],
  lang: 'en',
  createdAt: '2026-11-22T10:00:00.000Z',
  author: {
    name: 'Pavel Durov',
    handle: 'durov',
    avatar: 'https://pbs.twimg.com/profile_images/1/durov_normal.jpg',
    url: 'https://x.com/durov',
    verified: 'blue',
    affiliate: {
      name: 'Telegram Messenger',
      badge: 'https://pbs.twimg.com/semantic_core_img/1/telegram.jpg',
      url: 'https://x.com/telegram',
    },
  },
  stats: { replies: 1200, retweets: 5, likes: 31000, views: 2500000 },
};

test('renderRichText escapes the text and only links web addresses', () => {
  assert.equal(
    PhibPost.renderRichText('<b>hi</b> there', [{ start: 10, end: 15, url: 'javascript:alert(1)' }]),
    '&lt;b&gt;hi&lt;/b&gt; there'
  );
  assert.equal(
    PhibPost.renderRichText('<b>hi</b> there', [{ start: 10, end: 15, url: 'https://example.com' }]),
    '&lt;b&gt;hi&lt;/b&gt; <a href="https://example.com" target="_blank" rel="noopener nofollow">there</a>'
  );
  // Ranges outside the text are skipped rather than trusted.
  assert.equal(PhibPost.renderRichText('short', [{ start: 2, end: 99, url: 'https://example.com' }]), 'short');
});

test('safeHref allows web addresses and phib pages only', () => {
  assert.equal(PhibPost.safeHref('https://x.com/jack'), 'https://x.com/jack');
  assert.equal(PhibPost.safeHref('/jack/status/20'), '/jack/status/20');
  assert.equal(PhibPost.safeHref('//evil.example'), null);
  assert.equal(PhibPost.safeHref('javascript:alert(1)'), null);
  assert.equal(PhibPost.safeHref(undefined), null);
});

test('renderPost shows the author with their badges, the text and the counts', () => {
  const html = PhibPost.renderPost(tweet, { target: tweet.url, locale: 'en' });
  assert.match(html, /<a class="tweet-name"[^>]*>Pavel Durov<\/a>/);
  assert.match(html, /class="verified-badge" data-color="blue"/);
  // The affiliate badge loads through the proxy and stays clear of ad
  // blockers' .affiliate-link rule.
  assert.match(html, /<img class="org-badge" src="\/media\?url=https%3A%2F%2Fpbs\.twimg\.com%2Fsemantic_core_img/);
  assert.doesNotMatch(html, /affiliate/);
  assert.match(html, /Hello &lt;world&gt; &amp; <a href="https:\/\/x\.com\/jack"/);
  assert.match(html, /<span>1\.2K<\/span>/);
  assert.match(html, /<span>2\.5M<\/span>/);
  assert.doesNotMatch(html, /undefined|NaN|Invalid Date/);
});

test('renderPost leaves out a date it does not have', () => {
  const html = PhibPost.renderPost({ ...tweet, createdAt: undefined }, { target: tweet.url, locale: 'en' });
  assert.doesNotMatch(html, /undefined|NaN|Invalid Date/);
});

test('renderPost plays the video of links saved before media lists were stored', () => {
  const target = 'https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/720x1280/clip.mp4';
  const old = {
    url: tweet.url,
    text: 'An old link',
    createdAt: tweet.createdAt,
    author: { name: 'Pavel Durov', handle: 'durov', avatar: tweet.author.avatar, url: tweet.author.url },
    video: { thumbnail: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg', width: 720, height: 1280, duration: 12 },
    stats: { replies: 1, retweets: 2, likes: 3 },
  };
  const html = PhibPost.renderPost(old, { target, locale: 'en' });
  assert.match(html, new RegExp(`<video class="tweet-video" src="${PhibPost.escapeHtml(PhibPost.mediaUrl(target)).replace(/[.?*+()]/g, '\\$&')}"`));
  assert.match(html, /--ratio: 0\.5625/);
  assert.equal(PhibPost.postId(old), '2124638954272305593');
});
