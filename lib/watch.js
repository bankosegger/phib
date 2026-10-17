// Renders the page a short link to a Twitter video opens: the video plays in
// phib, with the tweet details underneath. Open Graph tags let chat apps
// show the video in their link previews.

const { mediaUrl } = require('./twitter');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCount(n) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
}

function renderWatchPage({ target, tweet }) {
  const { author, stats, video } = tweet;
  const e = escapeHtml;
  // Links saved before tweet ids were stored only have the tweet url.
  const tweetId = tweet.id || tweet.url.match(/\/status\/(\d+)/)[1];

  const title = `${author.name} (@${author.handle})`;
  const description = tweet.text.length > 200 ? `${tweet.text.slice(0, 199)}…` : tweet.text;

  const meta = [
    new Date(tweet.createdAt).toLocaleDateString('en', { dateStyle: 'medium' }),
    `${video.width}×${video.height}`,
    `${formatCount(stats.likes)} likes`,
    `${formatCount(stats.retweets)} reposts`,
  ];
  if (stats.views != null) {
    meta.push(`${formatCount(stats.views)} views`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<!-- video.twimg.com rejects requests with a Referer from another site -->
<meta name="referrer" content="no-referrer" />
<title>${e(title)} — phib</title>
<meta name="description" content="${e(description)}" />
<meta property="og:type" content="video.other" />
<meta property="og:title" content="${e(title)}" />
<meta property="og:description" content="${e(description)}" />
<meta property="og:image" content="${e(video.thumbnail)}" />
<meta property="og:video" content="${e(target)}" />
<meta property="og:video:secure_url" content="${e(target)}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="${e(video.width)}" />
<meta property="og:video:height" content="${e(video.height)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${e(title)}" />
<meta name="twitter:description" content="${e(description)}" />
<meta name="twitter:image" content="${e(video.thumbnail)}" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicons/favicon-96x96.png" />
<link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/favicons/site.webmanifest" />
<link rel="stylesheet" href="https://bankosegger.me/banko.css" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main class="card">
    <h1><a class="watch-title" href="/">Phib</a></h1>
    <p class="subtitle">Shared from X · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <div class="tweet">
        <video class="tweet-video" style="--ratio: ${e(video.width / video.height)}" src="${e(mediaUrl(target))}" poster="${e(mediaUrl(video.thumbnail))}" controls playsinline preload="metadata"></video>
        <div class="tweet-author">
          <img class="tweet-avatar" src="${e(mediaUrl(author.avatar))}" alt="" />
          <div>
            <a class="tweet-name" href="${e(author.url)}" target="_blank" rel="noopener">${e(author.name)}</a>
            <span class="tweet-handle">@${e(author.handle)}</span>
          </div>
        </div>
        <p class="tweet-text">${e(tweet.text)}</p>
        <p class="tweet-meta">
          ${e(meta.join(' · '))} ·
          <a href="${e(tweet.url)}" target="_blank" rel="noopener">View post</a> ·
          <a href="${e(target)}" target="_blank" rel="noopener">Open video file</a>
        </p>
      </div>
      <section class="comments" data-tweet-id="${e(tweetId)}" data-tweet-url="${e(tweet.url)}"></section>
    </div>
  </main>
  <script src="/comments.js"></script>
</body>
</html>`;
}

module.exports = { renderWatchPage };
