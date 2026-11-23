const form = document.getElementById('shorten-form');
const submitBtn = form.querySelector('button[type="submit"]');
const urlInput = document.getElementById('url-input');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLinkEl = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');
const historyEl = document.getElementById('history');
const historyBarEl = document.getElementById('history-bar');
const historyToggleEl = document.getElementById('history-toggle');
const historyCountEl = document.getElementById('history-count');
const tweetLayoutEl = document.getElementById('tweet-layout');
const tweetPostEl = document.getElementById('tweet-post');
const commentsEl = document.getElementById('comments');
const youtubeLayoutEl = document.getElementById('youtube-layout');
const choiceEl = document.getElementById('choice');
const choiceLabelEl = document.getElementById('choice-label');
const choiceShortBtn = document.getElementById('choice-short');
const choiceViewBtn = document.getElementById('choice-view');

const HISTORY_KEY = 'phib-history';
const QUOTE_KEY = 'phib-quote';

// Browsers that block site data throw on any use of localStorage. phib then
// just forgets the history and the last quote instead of breaking.
function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

const QUOTES = [
  'Get phibed!',
  'Phib it!',
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
  const stored = readStorage(QUOTE_KEY);
  const last = stored === null ? -1 : Number(stored);
  let index = Math.floor(Math.random() * QUOTES.length);
  if (index === last) {
    index = (index + 1) % QUOTES.length;
  }
  writeStorage(QUOTE_KEY, index);
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
    const items = JSON.parse(readStorage(HISTORY_KEY));
    return Array.isArray(items) ? items.filter((item) => item && typeof item.shortUrl === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  writeStorage(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
}

function deleteHistory() {
  removeStorage(HISTORY_KEY);
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

// The history list is folded away until the toggle is clicked.
let historyOpen = false;

function renderHistory() {
  const items = loadHistory();
  historyBarEl.hidden = items.length === 0;
  historyCountEl.textContent = items.length;
  historyEl.hidden = !historyOpen || items.length === 0;
  historyEl.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.title = item.source && item.source !== item.target ? `${item.source}\n→ ${item.target}` : item.target;

    const thumb = document.createElement('div');
    thumb.className = 'history-thumb';
    const thumbnail = item.tweet ? item.tweet.thumbnail && PhibPost.imageUrl(item.tweet.thumbnail) : item.youtube?.thumbnail;
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

    const a = document.createElement('a');
    a.href = item.shortUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.shortUrl.replace(/^https?:\/\//, '');

    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = describeTarget(item);

    const time = document.createElement('span');
    time.className = 'history-time';
    if (item.createdAt) {
      time.textContent = formatTimeAgo(item.createdAt);
      time.title = new Date(item.createdAt).toLocaleString();
    }

    li.append(thumb, a, target, time);
    historyEl.appendChild(li);
  }
}

// Stops the post's videos downloading before they go, then empties the post.
function clearPost() {
  for (const videoEl of tweetPostEl.querySelectorAll('video')) {
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
  }
  tweetPostEl.innerHTML = '';
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
  const channelUrl = PhibPost.safeHref(youtube.author.url);
  if (channelUrl) {
    channelEl.href = channelUrl;
  } else {
    channelEl.removeAttribute('href');
  }
  channelEl.textContent = youtube.author.name;
  document.getElementById('youtube-link').href = youtube.url;
  youtubeLayoutEl.hidden = false;
}

function hideTweet() {
  clearPost();
  tweetLayoutEl.hidden = true;
  clearComments(commentsEl);
}

// The post as public/post.js renders it, the same as on the page the short link
// opens. target is where the link points: the picked video or photo file, or
// the post.
function renderTweet(tweet, target) {
  if (!tweet) {
    hideTweet();
    return;
  }
  clearPost();
  tweetPostEl.innerHTML = PhibPost.renderPost(tweet, { target });
  tweetLayoutEl.hidden = false;
  // After it's shown, since Show more measures the text.
  PhibPost.enhance(tweetPostEl);
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
      thumbnail: PhibPost.thumbnail(data.tweet, data.target),
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

// Whether a link is being shortened. Looking up a post takes a moment, and
// the buttons wait meanwhile, so a second click can't make a second link.
let busy = false;

function setBusy(value) {
  busy = value;
  form.setAttribute('aria-busy', String(value));
  for (const button of form.querySelectorAll('button')) {
    button.disabled = value;
  }
  submitBtn.textContent = value ? 'Shortening…' : 'Shorten';
}

// view picks the Twitter/X post or YouTube view over a plain short link.
async function shorten(view) {
  if (busy) {
    return;
  }
  errorEl.hidden = true;
  const kind = pendingKind;
  hideChoice();

  const url = urlInput.value.trim();

  setBusy(true);
  let res;
  let data;
  try {
    res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        twitterVideo: view && kind === 'twitter',
        youtubeVideo: view && kind === 'youtube',
      }),
    });
    // Vercel answers timeouts with a page rather than JSON.
    data = await res.json().catch(() => ({}));
  } catch {
    showError('Could not reach the server. Please try again.');
    return;
  } finally {
    setBusy(false);
  }

  if (!res.ok) {
    showError(data.error || 'Something went wrong. Please try again.');
    return;
  }
  showResult(data);
  // Unless another link was pasted meanwhile.
  if (urlInput.value.trim() === url) {
    urlInput.value = '';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (busy) {
    return;
  }
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

clearBtn.addEventListener('click', deleteHistory);

historyToggleEl.addEventListener('click', () => {
  historyOpen = !historyOpen;
  historyToggleEl.setAttribute('aria-expanded', String(historyOpen));
  renderHistory();
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
