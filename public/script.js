const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLinkEl = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');
const historyEl = document.getElementById('history');
const tweetLayoutEl = document.getElementById('tweet-layout');
const commentsEl = document.getElementById('comments');
const youtubeLayoutEl = document.getElementById('youtube-layout');
const choiceEl = document.getElementById('choice');
const choiceLabelEl = document.getElementById('choice-label');
const choiceShortBtn = document.getElementById('choice-short');
const choiceViewBtn = document.getElementById('choice-view');

const HISTORY_KEY = 'phib-history';
const QUOTE_KEY = 'phib-quote';

const QUOTES = [
  'Get phibed!',
  'Phib it!.',
  'Long story short.',
  'Brevity is the soul of wit. This is very witty.',
  'Your URL called. It wants to lose some weight.',
  'Cutting links since… just now.',
  'Less is more. Shorter is morer.',
  'Fewer characters, same destination.',
  'Like a haircut, but for links.',
  'Every link deserves a fresh start.',
  'We put your URL on a diet.',
  "I would have written a shorter link, but I didn't have the time.",
  'Small link, big energy.',
  'Tiny link. Huge vibes.',
  'Making the internet slightly less long.',
  'Your link, now in travel size.',
  'Same link, fewer letters, zero regrets.',
  'Fun size URLs.',
  'Shrinking links, not expectations.',
  'Short links. Tall tales.',
  "It's not the size of the link, it's where it takes you.",
  'Proudly removing characters nobody will miss.',
  'Now with 100% less scrolling.',
  'The shortest distance between two points is this link.',
  'Pocket-sized URLs for big ideas.',
  'Keep calm and shorten on.',
];

// Shows a random quote under the title, never the same one twice in a row.
function showQuote() {
  const stored = localStorage.getItem(QUOTE_KEY);
  const last = stored === null ? -1 : Number(stored);
  let index = Math.floor(Math.random() * QUOTES.length);
  if (index === last) {
    index = (index + 1) % QUOTES.length;
  }
  localStorage.setItem(QUOTE_KEY, index);
  document.querySelector('.card > .subtitle').textContent = QUOTES[index];
}

showQuote();

const TWITTER_HOSTS = ['twitter.com', 'x.com', 'mobile.twitter.com', 'mobile.x.com'];
const YOUTUBE_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];
const VIDEO_ID = /^[\w-]{11}$/;

// Whether a link is a Twitter/X post or a YouTube video, mirroring parseStatus
// in lib/twitter.js and parseVideo in lib/youtube.js.
function detectKind(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (TWITTER_HOSTS.includes(host) && /\/status\/\d+/.test(url.pathname)) {
    return 'twitter';
  }
  let id;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.includes(host)) {
    const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
    id = match ? match[1] : url.pathname === '/watch' ? url.searchParams.get('v') : null;
  }
  return id && VIDEO_ID.test(id) ? 'youtube' : null;
}

const CHOICES = {
  twitter: { label: 'This is a Twitter/X post.', view: 'Post view' },
  youtube: { label: 'This is a YouTube video.', view: 'YouTube view' },
};

// The kind of link the choice is currently asked for, or null.
let pendingKind = null;

function showChoice(kind) {
  pendingKind = kind;
  choiceLabelEl.textContent = CHOICES[kind].label;
  choiceViewBtn.textContent = CHOICES[kind].view;
  choiceEl.hidden = false;
  choiceViewBtn.focus();
}

function hideChoice() {
  pendingKind = null;
  choiceEl.hidden = true;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
}

function deleteHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

const LINK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>';

// What a history entry points to: the tweet for Twitter/X posts, the video for
// YouTube links, otherwise the target address without its protocol.
function describeTarget(item) {
  if (item.tweet) {
    return `@${item.tweet.handle}: ${item.tweet.text}`;
  }
  if (item.youtube) {
    return `${item.youtube.channel}: ${item.youtube.title}`;
  }
  return (item.source || item.target).replace(/^https?:\/\/(www\.)?/, '');
}

function renderHistory() {
  const items = loadHistory();
  historyEl.innerHTML = '';
  clearBtn.hidden = items.length === 0;
  for (const item of items) {
    const li = document.createElement('li');

    const thumb = document.createElement('div');
    thumb.className = 'history-thumb';
    const thumbnail = item.tweet ? item.tweet.thumbnail && mediaUrl(item.tweet.thumbnail) : item.youtube?.thumbnail;
    if (thumbnail) {
      const img = document.createElement('img');
      img.src = thumbnail;
      img.alt = '';
      // Thumbnails disappear when a tweet is deleted.
      img.onerror = () => {
        thumb.innerHTML = LINK_ICON;
      };
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = LINK_ICON;
    }

    const body = document.createElement('div');
    body.className = 'history-body';

    const head = document.createElement('div');
    head.className = 'history-head';
    const a = document.createElement('a');
    a.href = item.shortUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.shortUrl.replace(/^https?:\/\//, '');
    head.appendChild(a);
    if (item.createdAt) {
      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatTimeAgo(item.createdAt);
      time.title = new Date(item.createdAt).toLocaleString();
      head.appendChild(time);
    }

    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = describeTarget(item);
    target.title = item.source && item.source !== item.target ? `${item.source}\n→ ${item.target}` : item.target;

    body.append(head, target);
    li.append(thumb, body);
    historyEl.appendChild(li);
  }
}

function formatCount(n) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
}

// twimg.com is blocked as a third-party tracker by Firefox strict mode and many
// content blockers, so Twitter media is loaded through phib's /media proxy.
function mediaUrl(value) {
  return `/media?url=${encodeURIComponent(value)}`;
}

function hideVideo() {
  const videoEl = document.getElementById('tweet-video');
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  videoEl.parentElement.hidden = true;
}

function renderYouTube(youtube) {
  const playerEl = document.getElementById('youtube-player');
  if (!youtube) {
    playerEl.removeAttribute('src');
    youtubeLayoutEl.hidden = true;
    return;
  }
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${youtube.id}`);
  if (youtube.start) {
    embed.searchParams.set('start', youtube.start);
  }
  playerEl.src = embed;
  playerEl.title = youtube.title;
  playerEl.parentElement.style.setProperty('--ratio', youtube.short ? 9 / 16 : 16 / 9);
  document.getElementById('youtube-backdrop').src = youtube.thumbnail;
  document.getElementById('youtube-title').textContent = youtube.title;
  const channelEl = document.getElementById('youtube-channel');
  channelEl.href = youtube.author.url;
  channelEl.textContent = youtube.author.name;
  document.getElementById('youtube-link').href = youtube.url;
  youtubeLayoutEl.hidden = false;
}

function hideTweet() {
  hideVideo();
  tweetLayoutEl.hidden = true;
  clearComments(commentsEl);
}

// The picture that stands for a tweet in the history.
function tweetThumbnail(tweet) {
  if (tweet.video) {
    return tweet.video.thumbnail;
  }
  if (tweet.photos) {
    return tweet.photos[0].url;
  }
  return tweet.author.avatar;
}

function renderPhotos(photos) {
  const photosEl = document.getElementById('tweet-photos');
  photosEl.innerHTML = '';
  photosEl.hidden = !photos;
  if (!photos) {
    return;
  }
  photosEl.dataset.count = photos.length;
  photosEl.style.setProperty('--ratio', photos[0].width / photos[0].height);
  if (photos.length === 1) {
    const backdrop = document.createElement('img');
    backdrop.className = 'tweet-media-backdrop';
    backdrop.src = mediaUrl(photos[0].url);
    backdrop.alt = '';
    photosEl.appendChild(backdrop);
  }
  for (const photo of photos) {
    const a = document.createElement('a');
    a.href = mediaUrl(photo.url);
    a.target = '_blank';
    a.rel = 'noopener';
    const img = document.createElement('img');
    img.className = 'tweet-photo';
    img.src = mediaUrl(photo.url);
    img.alt = '';
    a.appendChild(img);
    photosEl.appendChild(a);
  }
}

// The quoted post, linking to its own phib page; markup matches lib/watch.js.
function renderQuote(quote) {
  const quoteEl = document.getElementById('tweet-quote');
  quoteEl.innerHTML = '';
  quoteEl.hidden = !quote;
  if (!quote) {
    return;
  }
  quoteEl.href = `/${quote.author.handle}/status/${quote.id}`;

  const author = document.createElement('span');
  author.className = 'tweet-author';
  const avatar = document.createElement('img');
  avatar.className = 'tweet-avatar';
  avatar.src = mediaUrl(quote.author.avatar);
  avatar.alt = '';
  const names = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'tweet-name';
  name.textContent = quote.author.name;
  const handle = document.createElement('span');
  handle.className = 'tweet-handle';
  handle.textContent = `@${quote.author.handle}`;
  names.append(name, handle);
  author.append(avatar, names);

  const text = document.createElement('span');
  text.className = 'tweet-text';
  text.textContent = quote.text;
  quoteEl.append(author, text);

  if (quote.images) {
    const images = document.createElement('span');
    images.className = 'tweet-quote-images';
    for (const image of quote.images) {
      const img = document.createElement('img');
      img.className = 'tweet-quote-image';
      img.src = mediaUrl(image.url);
      img.alt = '';
      images.appendChild(img);
    }
    quoteEl.appendChild(images);
  }
}

function renderTweet(tweet, videoUrl) {
  if (!tweet) {
    hideTweet();
    return;
  }
  const { author, stats, video } = tweet;

  if (video) {
    const videoEl = document.getElementById('tweet-video');
    videoEl.parentElement.style.setProperty('--ratio', video.width / video.height);
    videoEl.poster = mediaUrl(video.thumbnail);
    document.getElementById('tweet-video-backdrop').src = mediaUrl(video.thumbnail);
    videoEl.src = mediaUrl(videoUrl);
    videoEl.parentElement.hidden = false;
  } else {
    hideVideo();
  }
  renderPhotos(tweet.photos);
  document.getElementById('tweet-link').href = tweet.url;

  document.getElementById('tweet-avatar').src = mediaUrl(author.avatar);
  const nameEl = document.getElementById('tweet-name');
  nameEl.href = author.url;
  nameEl.textContent = author.name;
  document.getElementById('tweet-handle').textContent = `@${author.handle}`;

  document.getElementById('tweet-text').textContent = tweet.text;
  renderQuote(tweet.quote);

  document.getElementById('tweet-date').textContent = new Date(tweet.createdAt).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
  const counts = { replies: stats.replies, reposts: stats.retweets, likes: stats.likes, views: stats.views };
  for (const [kind, count] of Object.entries(counts)) {
    const countEl = document.getElementById(`tweet-${kind}`);
    countEl.textContent = count == null ? '' : formatCount(count);
    countEl.parentElement.hidden = count == null;
  }

  tweetLayoutEl.hidden = false;
  showComments(commentsEl, tweet.id, tweet.url);
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
  hideTweet();
  renderYouTube(null);
}

function showResult(data) {
  errorEl.hidden = true;
  shortLinkEl.href = data.shortUrl;
  shortLinkEl.textContent = data.shortUrl;
  resultEl.hidden = false;
  renderTweet(data.tweet, data.target);
  renderYouTube(data.youtube);

  const items = loadHistory();
  items.unshift({
    code: data.code,
    shortUrl: data.shortUrl,
    target: data.target,
    source: data.source,
    createdAt: new Date().toISOString(),
    tweet: data.tweet && {
      handle: data.tweet.author.handle,
      text: data.tweet.text.slice(0, 140),
      thumbnail: tweetThumbnail(data.tweet),
    },
    youtube: data.youtube && {
      channel: data.youtube.author.name,
      title: data.youtube.title,
      thumbnail: data.youtube.thumbnail,
    },
  });
  saveHistory(items);
  renderHistory();
}

// view picks the Twitter/X post or YouTube view over a plain short link.
async function shorten(view) {
  errorEl.hidden = true;
  const kind = pendingKind;
  hideChoice();

  const url = urlInput.value.trim();

  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        twitterVideo: view && kind === 'twitter',
        youtubeVideo: view && kind === 'youtube',
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong.');
      return;
    }

    showResult(data);
    urlInput.value = '';
  } catch {
    showError('Could not reach the server. Please try again.');
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const kind = detectKind(urlInput.value.trim());
  if (kind) {
    errorEl.hidden = true;
    showChoice(kind);
    return;
  }
  shorten(false);
});

choiceShortBtn.addEventListener('click', () => shorten(false));
choiceViewBtn.addEventListener('click', () => shorten(true));

// A different link needs its own answer.
urlInput.addEventListener('input', hideChoice);

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shortLinkEl.href);
    copyBtn.classList.add('copied');
    copyBtn.setAttribute('aria-label', 'Copied');
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.setAttribute('aria-label', 'Copy short link');
    }, 1500);
  } catch {
    copyBtn.setAttribute('aria-label', 'Copy failed');
  }
});

clearBtn.addEventListener('click', async () => {
  try {
    deleteHistory();
  } catch {
    console.error('failed to clear history.')
  }
});

renderHistory();

// URL mode: the server sends pb3p.uk/https://... here as /?url=..., which is
// shortened right away.
const prefilled = new URLSearchParams(location.search).get('url');
if (prefilled) {
  history.replaceState(null, '', '/');
  urlInput.value = prefilled;
  form.requestSubmit();
}
