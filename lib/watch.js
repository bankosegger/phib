// Renders the page a short link to a tweet opens: the tweet's video or photos
// show in phib, with the tweet details underneath. Open Graph tags let chat apps
// show the video or photo in their link previews.

const { mediaUrl, tweetThumbnail } = require('./twitter');
const { embedUrl } = require('./youtube');

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

  const thumbnail = tweetThumbnail(tweet);

  const meta = [new Date(tweet.createdAt).toLocaleDateString('en', { dateStyle: 'medium' })];
  if (video) {
    meta.push(`${video.width}×${video.height}`);
  }
  meta.push(
    `${formatCount(stats.likes)} likes`,
    `${formatCount(stats.retweets)} reposts`
  );
  if (stats.views != null) {
    meta.push(`${formatCount(stats.views)} views`);
  }

  let previewTags;
  let mediaHtml = '';
  if (video) {
    previewTags = `<meta property="og:type" content="video.other" />
<meta property="og:image" content="${e(thumbnail)}" />
<meta property="og:video" content="${e(target)}" />
<meta property="og:video:secure_url" content="${e(target)}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="${e(video.width)}" />
<meta property="og:video:height" content="${e(video.height)}" />
<meta name="twitter:card" content="summary_large_image" />`;
    mediaHtml = `<video class="tweet-video" style="--ratio: ${e(video.width / video.height)}" src="${e(mediaUrl(target))}" poster="${e(mediaUrl(thumbnail))}" controls playsinline preload="metadata"></video>`;
  } else {
    previewTags = `<meta property="og:type" content="article" />
<meta property="og:image" content="${e(thumbnail)}" />
<meta name="twitter:card" content="${tweet.photos ? 'summary_large_image' : 'summary'}" />`;
    if (tweet.photos) {
      const photos = tweet.photos
        .map(
          (photo) =>
            `<a href="${e(mediaUrl(photo.url))}" target="_blank" rel="noopener"><img class="tweet-photo" style="--ratio: ${e(photo.width / photo.height)}" src="${e(mediaUrl(photo.url))}" alt="" /></a>`
        )
        .join('');
      mediaHtml = `<div class="tweet-photos" data-count="${tweet.photos.length}">${photos}</div>`;
    }
  }

  let quoteHtml = '';
  if (tweet.quote) {
    const { quote } = tweet;
    const images = (quote.images || [])
      .map(
        (image) =>
          `<img class="tweet-photo" style="--ratio: ${e(image.width / image.height)}" src="${e(mediaUrl(image.url))}" alt="" />`
      )
      .join('');
    quoteHtml = `<a class="tweet-quote" href="/${e(quote.author.handle)}/status/${e(quote.id)}">
          <span class="tweet-author">
            <img class="tweet-avatar" src="${e(mediaUrl(quote.author.avatar))}" alt="" />
            <span>
              <span class="tweet-name">${e(quote.author.name)}</span>
              <span class="tweet-handle">@${e(quote.author.handle)}</span>
            </span>
          </span>
          <span class="tweet-text">${e(quote.text)}</span>
          ${images ? `<span class="tweet-photos" data-count="${quote.images.length}">${images}</span>` : ''}
        </a>`;
  }

  const links = [`<a href="${e(tweet.url)}" target="_blank" rel="noopener">View post</a>`];
  if (video) {
    links.push(`<a href="${e(target)}" target="_blank" rel="noopener">Open video file</a>`);
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
<meta property="og:title" content="${e(title)}" />
<meta property="og:description" content="${e(description)}" />
${previewTags}
<meta name="twitter:title" content="${e(title)}" />
<meta name="twitter:description" content="${e(description)}" />
<meta name="twitter:image" content="${e(thumbnail)}" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicons/favicon-96x96.png" />
<link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/favicons/site.webmanifest" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main class="card">
    <h1><a class="watch-title" href="/">Phib</a></h1>
    <p class="subtitle">Shared from X · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <div class="tweet">
        ${mediaHtml}
        <div class="tweet-author">
          <img class="tweet-avatar" src="${e(mediaUrl(author.avatar))}" alt="" />
          <div>
            <a class="tweet-name" href="${e(author.url)}" target="_blank" rel="noopener">${e(author.name)}</a>
            <span class="tweet-handle">@${e(author.handle)}</span>
          </div>
        </div>
        <p class="tweet-text">${e(tweet.text)}</p>
        ${quoteHtml}
        <p class="tweet-meta">
          ${e(meta.join(' · '))} ·
          ${links.join(' · ')}
        </p>
      </div>
      <section class="comments" data-tweet-id="${e(tweetId)}" data-tweet-url="${e(tweet.url)}"></section>
    </div>
  </main>
  <script src="/comments.js"></script>
</body>
</html>`;
}

// The page a short link to a YouTube video opens. Unlike the tweet page it keeps
// the default referrer policy, since YouTube's player refuses to play without one.
function renderYouTubePage({ youtube }) {
  const e = escapeHtml;
  const { author } = youtube;
  const embed = embedUrl(youtube);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${e(youtube.title)} — phib</title>
<meta name="description" content="${e(author.name)} on YouTube" />
<meta property="og:type" content="video.other" />
<meta property="og:title" content="${e(youtube.title)}" />
<meta property="og:description" content="${e(author.name)} on YouTube" />
<meta property="og:image" content="${e(youtube.thumbnail)}" />
<meta property="og:video" content="${e(embed)}" />
<meta property="og:video:secure_url" content="${e(embed)}" />
<meta property="og:video:type" content="text/html" />
<meta property="og:video:width" content="${youtube.short ? 720 : 1280}" />
<meta property="og:video:height" content="${youtube.short ? 1280 : 720}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${e(youtube.title)}" />
<meta name="twitter:description" content="${e(author.name)} on YouTube" />
<meta name="twitter:image" content="${e(youtube.thumbnail)}" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicons/favicon-96x96.png" />
<link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/favicons/site.webmanifest" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main class="card">
    <h1><a class="watch-title" href="/">Phib</a></h1>
    <p class="subtitle">Shared from YouTube · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <div class="tweet">
        <iframe class="tweet-video youtube-player" style="--ratio: ${youtube.short ? '9 / 16' : '16 / 9'}" src="${e(embed)}" title="${e(youtube.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
        <p class="tweet-text youtube-title">${e(youtube.title)}</p>
        <p class="tweet-meta">
          <a href="${e(author.url)}" target="_blank" rel="noopener">${e(author.name)}</a> ·
          <a href="${e(youtube.url)}" target="_blank" rel="noopener">Watch on YouTube</a>
        </p>
      </div>
    </div>
  </main>
</body>
</html>`;
}

module.exports = { renderWatchPage, renderYouTubePage };
