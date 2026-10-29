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

// The counts under the tweet, with x.com's icons (from Lucide). public/index.html
// has the same markup.
const STAT_ICONS = {
  replies: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  reposts: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  likes: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  views: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
};

// Old tweets have no view count; their views stat is left out.
function renderStat(kind, count) {
  if (count == null) {
    return '';
  }
  return `<span class="tweet-stat" title="${escapeHtml(`${count} ${kind}`)}"><svg viewBox="0 0 24 24" aria-hidden="true">${STAT_ICONS[kind]}</svg><span>${escapeHtml(formatCount(count))}</span></span>`;
}

function renderWatchPage({ target, tweet }) {
  const { author, stats, video } = tweet;
  const e = escapeHtml;
  // Links saved before tweet ids were stored only have the tweet url.
  const tweetId = tweet.id || tweet.url.match(/\/status\/(\d+)/)[1];

  const title = `${author.name} (@${author.handle})`;
  const description = tweet.text.length > 200 ? `${tweet.text.slice(0, 199)}…` : tweet.text;

  const thumbnail = tweetThumbnail(tweet);

  const date = new Date(tweet.createdAt).toLocaleDateString('en', { dateStyle: 'medium' });
  const statsHtml = [
    renderStat('replies', stats.replies),
    renderStat('reposts', stats.retweets),
    renderStat('likes', stats.likes),
    renderStat('views', stats.views),
  ].join('');

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
    mediaHtml = `<div class="tweet-media" style="--ratio: ${e(video.width / video.height)}"><img class="tweet-media-backdrop" src="${e(mediaUrl(thumbnail))}" alt="" /><video class="tweet-video" src="${e(mediaUrl(target))}" poster="${e(mediaUrl(thumbnail))}" controls playsinline preload="metadata"></video></div>`;
  } else {
    previewTags = `<meta property="og:type" content="article" />
<meta property="og:image" content="${e(thumbnail)}" />
<meta name="twitter:card" content="${tweet.photos ? 'summary_large_image' : 'summary'}" />`;
    if (tweet.photos) {
      const photos = tweet.photos
        .map(
          (photo) =>
            `<a href="${e(mediaUrl(photo.url))}" target="_blank" rel="noopener"><img class="tweet-photo" src="${e(mediaUrl(photo.url))}" alt="" /></a>`
        )
        .join('');
      const [first] = tweet.photos;
      const backdrop =
        tweet.photos.length === 1 ? `<img class="tweet-media-backdrop" src="${e(mediaUrl(first.url))}" alt="" />` : '';
      mediaHtml = `<div class="tweet-media tweet-photos" data-count="${tweet.photos.length}" style="--ratio: ${e(first.width / first.height)}">${backdrop}${photos}</div>`;
    }
  }

  let quoteHtml = '';
  if (tweet.quote) {
    const { quote } = tweet;
    const images = (quote.images || [])
      .map(
        (image) =>
          `<img class="tweet-quote-image" src="${e(mediaUrl(image.url))}" alt="" />`
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
          ${images ? `<span class="tweet-quote-images">${images}</span>` : ''}
        </a>`;
  }

  const links = [`<a href="${e(tweet.url)}" target="_blank" rel="noopener">View on X</a>`];
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
      <article class="tweet">
        <div class="tweet-author">
          <img class="tweet-avatar" src="${e(mediaUrl(author.avatar))}" alt="" />
          <div>
            <a class="tweet-name" href="${e(author.url)}" target="_blank" rel="noopener">${e(author.name)}</a>
            <span class="tweet-handle">@${e(author.handle)}</span>
          </div>
        </div>
        <p class="tweet-text">${e(tweet.text)}</p>
        ${mediaHtml}
        ${quoteHtml}
        <p class="tweet-meta">${e(date)} · ${links.join(' · ')}</p>
        <div class="tweet-stats">${statsHtml}</div>
      </article>
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
        <div class="tweet-media" style="--ratio: ${youtube.short ? '9 / 16' : '16 / 9'}">
          <img class="tweet-media-backdrop" src="${e(youtube.thumbnail)}" alt="" />
          <iframe class="tweet-video youtube-player" src="${e(embed)}" title="${e(youtube.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
        </div>
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
