// Renders the page a short link to a tweet opens: the tweet as public/post.js
// shows it (the home page shows it the same way), with its replies beside it.
// Open Graph tags let chat apps show the video or photo in their link previews.

const PhibPost = require('../public/post');
const { embedUrl } = require('./youtube');

const { escapeHtml } = PhibPost;

function renderWatchPage({ target, tweet }) {
  const { author } = tweet;
  const e = escapeHtml;
  const tweetId = PhibPost.postId(tweet);

  const title = `${author.name} (@${author.handle})`;
  const description = tweet.text.length > 200 ? `${tweet.text.slice(0, 199)}…` : tweet.text;

  const picked = PhibPost.pickedMedia(tweet, target);
  let image = PhibPost.thumbnail(tweet, target);
  let previewTags;
  if (picked && picked.type !== 'photo') {
    previewTags = `<meta property="og:type" content="video.other" />
<meta property="og:video" content="${e(target)}" />
<meta property="og:video:secure_url" content="${e(target)}" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="${e(picked.width)}" />
<meta property="og:video:height" content="${e(picked.height)}" />
<meta name="twitter:card" content="summary_large_image" />`;
  } else {
    // Previews show one picture, so several photos show as FxTwitter's mosaic
    // of them.
    if (!picked && tweet.mosaic) {
      image = tweet.mosaic;
    }
    const large = Boolean(
      picked || tweet.photos || (tweet.media && tweet.media.length) || tweet.external || (tweet.card && tweet.card.image)
    );
    previewTags = `<meta property="og:type" content="article" />
<meta name="twitter:card" content="${large ? 'summary_large_image' : 'summary'}" />`;
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
<meta property="og:image" content="${e(image)}" />
${previewTags}
<meta name="twitter:title" content="${e(title)}" />
<meta name="twitter:description" content="${e(description)}" />
<meta name="twitter:image" content="${e(image)}" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicons/favicon-96x96.png" />
<link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/favicons/site.webmanifest" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main class="card">
    <h1 class="logo"><a class="watch-title" href="/" aria-label="Phib"><span aria-hidden="true">P<span class="logo-extra"><span>h</span><span>h</span><span>h</span><span>h</span></span>hib<span class="logo-dot">.</span></span></a></h1>
    <p class="subtitle">Shared from X · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <article class="tweet">${PhibPost.renderPost(tweet, { target, locale: 'en' })}</article>
      <section class="comments" data-tweet-id="${e(tweetId)}" data-tweet-url="${e(tweet.url)}"></section>
    </div>
  </main>
  <script src="/post.js"></script>
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
    <h1 class="logo"><a class="watch-title" href="/" aria-label="Phib"><span aria-hidden="true">P<span class="logo-extra"><span>h</span><span>h</span><span>h</span><span>h</span></span>hib<span class="logo-dot">.</span></span></a></h1>
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
