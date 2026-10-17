const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLinkEl = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');
const historyEl = document.getElementById('history');
const twitterVideoEl = document.getElementById('twitter-video');
const tweetLayoutEl = document.getElementById('tweet-layout');
const commentsEl = document.getElementById('comments');

const HISTORY_KEY = 'phib-history';
const QUOTE_KEY = 'phib-quote';

const QUOTES = [
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
const TWITTER_VIDEO_KEY = 'phib-twitter-video';

twitterVideoEl.checked = localStorage.getItem(TWITTER_VIDEO_KEY) === 'true';
twitterVideoEl.addEventListener('change', () => {
  localStorage.setItem(TWITTER_VIDEO_KEY, twitterVideoEl.checked);
});

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

// What a history entry points to: the tweet for Twitter videos, otherwise the
// target address without its protocol.
function describeTarget(item) {
  if (item.tweet) {
    return `@${item.tweet.handle}: ${item.tweet.text}`;
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
    if (item.tweet && item.tweet.thumbnail) {
      const img = document.createElement('img');
      img.src = mediaUrl(item.tweet.thumbnail);
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

function hideTweet() {
  const videoEl = document.getElementById('tweet-video');
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  tweetLayoutEl.hidden = true;
  clearComments(commentsEl);
}

function renderTweet(tweet, videoUrl) {
  if (!tweet) {
    hideTweet();
    return;
  }
  const { author, stats, video } = tweet;

  const videoEl = document.getElementById('tweet-video');
  videoEl.style.setProperty('--ratio', video.width / video.height);
  videoEl.poster = mediaUrl(video.thumbnail);
  videoEl.src = mediaUrl(videoUrl);
  document.getElementById('tweet-link').href = tweet.url;

  document.getElementById('tweet-avatar').src = mediaUrl(author.avatar);
  const nameEl = document.getElementById('tweet-name');
  nameEl.href = author.url;
  nameEl.textContent = author.name;
  document.getElementById('tweet-handle').textContent = `@${author.handle}`;

  document.getElementById('tweet-text').textContent = tweet.text;

  const meta = [
    new Date(tweet.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' }),
    `${video.width}×${video.height}`,
    `${formatCount(stats.likes)} likes`,
    `${formatCount(stats.retweets)} reposts`,
  ];
  if (stats.views != null) {
    meta.push(`${formatCount(stats.views)} views`);
  }
  document.getElementById('tweet-meta').textContent = meta.join(' · ');

  tweetLayoutEl.hidden = false;
  showComments(commentsEl, tweet.id, tweet.url);
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
  hideTweet();
}

function showResult(data) {
  errorEl.hidden = true;
  shortLinkEl.href = data.shortUrl;
  shortLinkEl.textContent = data.shortUrl;
  resultEl.hidden = false;
  renderTweet(data.tweet, data.target);

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
      thumbnail: data.tweet.video.thumbnail,
    },
  });
  saveHistory(items);
  renderHistory();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const url = urlInput.value.trim();

  try {
    const res = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, twitterVideo: twitterVideoEl.checked }),
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
});

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
