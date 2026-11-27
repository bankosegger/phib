// Renders the pages phib builds on the server: the page a short link to a tweet
// opens (the tweet as public/post.js shows it, the home page shows it the same
// way, with its replies beside it), the ones for a YouTube video and an
// Instagram post, and the error page. Open Graph tags let chat apps show the
// video or photo in their link previews.

const PhibPost = require('../public/post');
const PhibInstagram = require('../public/instagram');
const { embedUrl } = require('./youtube');

const { escapeHtml: e } = PhibPost;

// The wordmark, linking home.
const LOGO =
  '<h1 class="logo"><a class="watch-title" href="/" aria-label="Phib"><span aria-hidden="true">P<span class="logo-extra"><span>h</span><span>h</span><span>h</span><span>h</span></span>hib<span class="logo-dot">.</span></span></a></h1>';

// The tags chat apps and search engines read: title, description and picture.
function previewTags({ title, description, image }) {
  return [
    `<meta name="description" content="${e(description)}" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(description)}" />`,
    image ? `<meta property="og:image" content="${e(image)}" />` : '',
    `<meta name="twitter:title" content="${e(title)}" />`,
    `<meta name="twitter:description" content="${e(description)}" />`,
    image ? `<meta name="twitter:image" content="${e(image)}" />` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// A whole page around its <main>. head holds the page's own tags.
function renderPage({ title, head = '', body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${e(title)}</title>
${head}
<link rel="icon" type="image/png" sizes="96x96" href="/favicons/favicon-96x96.png" />
<link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/favicons/site.webmanifest" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
${body}
</body>
</html>`;
}

function renderWatchPage({ target, tweet }) {
  const { author } = tweet;
  const tweetId = PhibPost.postId(tweet);

  const title = `${author.name} (@${author.handle})`;
  const description = tweet.text.length > 200 ? `${tweet.text.slice(0, 199)}…` : tweet.text;

  const picked = PhibPost.pickedMedia(tweet, target);
  let image = PhibPost.thumbnail(tweet, target);
  let mediaTags;
  if (picked && picked.type !== 'photo') {
    mediaTags = [
      '<meta property="og:type" content="video.other" />',
      `<meta property="og:video" content="${e(target)}" />`,
      `<meta property="og:video:secure_url" content="${e(target)}" />`,
      '<meta property="og:video:type" content="video/mp4" />',
      picked.width ? `<meta property="og:video:width" content="${e(picked.width)}" />` : '',
      picked.height ? `<meta property="og:video:height" content="${e(picked.height)}" />` : '',
      '<meta name="twitter:card" content="summary_large_image" />',
    ];
  } else {
    // Previews show one picture, so several photos show as FxTwitter's mosaic
    // of them.
    if (!picked && tweet.mosaic) {
      image = tweet.mosaic;
    }
    const large = Boolean(
      picked || tweet.photos || (tweet.media && tweet.media.length) || tweet.external || (tweet.card && tweet.card.image)
    );
    mediaTags = [
      '<meta property="og:type" content="article" />',
      `<meta name="twitter:card" content="${large ? 'summary_large_image' : 'summary'}" />`,
    ];
  }

  return renderPage({
    title: `${title} — phib`,
    head: [
      // video.twimg.com rejects requests with a Referer from another site.
      '<meta name="referrer" content="no-referrer" />',
      previewTags({ title, description, image }),
      ...mediaTags.filter(Boolean),
    ].join('\n'),
    body: `  <main class="card">
    ${LOGO}
    <p class="subtitle">Shared from X · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <article class="tweet">${PhibPost.renderPost(tweet, { target, locale: 'en' })}</article>
      <section class="comments" data-tweet-id="${e(tweetId)}" data-tweet-url="${e(tweet.url)}"></section>
    </div>
  </main>
  <script src="/post.js"></script>
  <script src="/comments.js"></script>`,
  });
}

// The page a short link to a YouTube video opens. Unlike the tweet page it keeps
// the default referrer policy, since YouTube's player refuses to play without one.
function renderYouTubePage({ youtube }) {
  const { author } = youtube;
  const embed = embedUrl(youtube);
  const description = `${author.name} on YouTube`;
  const channel = PhibPost.safeHref(author.url)
    ? `<a href="${e(author.url)}" target="_blank" rel="noopener">${e(author.name)}</a>`
    : e(author.name);

  return renderPage({
    title: `${youtube.title} — phib`,
    head: [
      previewTags({ title: youtube.title, description, image: youtube.thumbnail }),
      '<meta property="og:type" content="video.other" />',
      `<meta property="og:video" content="${e(embed)}" />`,
      `<meta property="og:video:secure_url" content="${e(embed)}" />`,
      '<meta property="og:video:type" content="text/html" />',
      `<meta property="og:video:width" content="${youtube.short ? 720 : 1280}" />`,
      `<meta property="og:video:height" content="${youtube.short ? 1280 : 720}" />`,
      '<meta name="twitter:card" content="summary_large_image" />',
    ].join('\n'),
    body: `  <main class="card">
    ${LOGO}
    <p class="subtitle">Shared from YouTube · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <div class="tweet">
        <div class="tweet-media" style="--ratio: ${youtube.short ? '9 / 16' : '16 / 9'}">
          <img class="tweet-media-backdrop" src="${e(youtube.thumbnail)}" alt="" />
          <iframe class="tweet-video youtube-player" src="${e(embed)}" title="${e(youtube.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
        </div>
        <p class="tweet-text youtube-title">${e(youtube.title)}</p>
        <p class="tweet-meta">
          ${channel} ·
          <a href="${e(youtube.url)}" target="_blank" rel="noopener">Watch on YouTube</a>
        </p>
      </div>
    </div>
  </main>`,
  });
}

// The page a short link to an Instagram post opens, and proxy mode's
// (pb3p.uk/reel/...). Chat apps fetch the preview's picture and video from
// Instagram's servers themselves, so those point there, while the page's own
// load through the /media proxy.
function renderInstagramPage({ instagram }) {
  const { author } = instagram;
  const title = `${author.name} (@${author.handle})`;
  const caption = instagram.text || `@${author.handle} on Instagram`;
  const description = caption.length > 200 ? `${caption.slice(0, 199)}…` : caption;
  const [first] = instagram.media;

  let mediaTags;
  if (first && first.type === 'video') {
    mediaTags = [
      '<meta property="og:type" content="video.other" />',
      `<meta property="og:video" content="${e(first.url)}" />`,
      `<meta property="og:video:secure_url" content="${e(first.url)}" />`,
      '<meta property="og:video:type" content="video/mp4" />',
      first.width ? `<meta property="og:video:width" content="${e(first.width)}" />` : '',
      first.height ? `<meta property="og:video:height" content="${e(first.height)}" />` : '',
    ];
  } else {
    mediaTags = ['<meta property="og:type" content="article" />'];
  }

  return renderPage({
    title: `${title} — phib`,
    head: [
      // Instagram's media servers needn't learn which page their files are
      // opened from.
      '<meta name="referrer" content="no-referrer" />',
      previewTags({ title, description, image: PhibInstagram.thumbnail(instagram) }),
      ...mediaTags.filter(Boolean),
      '<meta name="twitter:card" content="summary_large_image" />',
    ].join('\n'),
    body: `  <main class="card">
    ${LOGO}
    <p class="subtitle">Shared from Instagram · <a href="/">Shorten your own link</a></p>
    <div class="tweet-layout">
      <article class="tweet">${PhibInstagram.renderPost(instagram, { locale: 'en' })}</article>
    </div>
  </main>
  <script src="/post.js"></script>
  <script src="/instagram.js"></script>`,
  });
}

// What phib shows when something fails on its side or upstream, like X or
// YouTube not answering.
function renderErrorPage({ status = 500, message = 'Something went wrong. Please try again in a moment.' } = {}) {
  return renderPage({
    title: 'phib — something went wrong',
    head: '<meta name="robots" content="noindex" />',
    body: `  <main class="card notice">
    <h1>${e(status)}</h1>
    <p class="subtitle">${e(message)}</p>
    <a href="/">Go back home</a>
  </main>`,
  });
}

module.exports = { renderWatchPage, renderYouTubePage, renderInstagramPage, renderErrorPage };
