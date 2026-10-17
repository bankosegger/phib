const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');
const shortLinkEl = document.getElementById('short-link');
const copyBtn = document.getElementById('copy-btn');
const historyEl = document.getElementById('history');
const twitterVideoEl = document.getElementById('twitter-video');
const tweetEl = document.getElementById('tweet');

const HISTORY_KEY = 'phib-history';
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

function renderHistory() {
  const items = loadHistory();
  historyEl.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');

    const a = document.createElement('a');
    a.href = item.shortUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.shortUrl.replace(/^https?:\/\//, '');

    const target = document.createElement('span');
    target.className = 'target';
    target.title = item.target;
    try {
      target.textContent = new URL(item.target).hostname.replace(/^www\./, '');
    } catch {
      target.textContent = item.target;
    }

    li.appendChild(a);
    li.appendChild(target);
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
  tweetEl.hidden = true;
}

function renderTweet(tweet, videoUrl) {
  if (!tweet) {
    hideTweet();
    return;
  }
  const { author, stats, video } = tweet;

  const videoEl = document.getElementById('tweet-video');
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

  tweetEl.hidden = false;
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
  items.unshift({ code: data.code, shortUrl: data.shortUrl, target: data.target });
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

renderHistory();
