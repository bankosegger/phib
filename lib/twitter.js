const TWITTER_HOSTS = ['twitter.com', 'x.com', 'mobile.twitter.com', 'mobile.x.com'];

// Returns { id, kind, index } for tweet links, where kind is "video" or "photo"
// and index is the 0-based media item picked by a trailing /video/N or
// /photo/N (defaults to the first video).
function parseStatus(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!TWITTER_HOSTS.includes(host)) {
    return null;
  }
  const match = url.pathname.match(/\/status\/(\d+)(?:\/(video|photo)\/(\d+))?/);
  if (!match) {
    return null;
  }
  return {
    id: match[1],
    kind: match[2] || 'video',
    index: match[3] ? Math.max(Number(match[3]) - 1, 0) : 0,
  };
}

function isTwimg(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && (host === 'twimg.com' || host.endsWith('.twimg.com'));
}

// twimg.com is blocked as a third-party tracker by Firefox strict mode and many
// content blockers, so the page loads Twitter media through phib's /media proxy.
function mediaUrl(value) {
  return `/media?url=${encodeURIComponent(value)}`;
}

class TwitterError extends Error {}

// The color of an account's verified checkmark, as on x.com: grey for
// governments, gold for organizations and blue for everyone else. Unverified
// accounts get null rather than nothing, so stored links tell them apart from
// links saved before badges were (see addBadges in server.js).
function checkmark(verification) {
  if (!verification || !verification.verified) {
    return null;
  }
  if (verification.type === 'government') {
    return 'grey';
  }
  return verification.type === 'organization' || verification.type === 'business' ? 'gold' : 'blue';
}

// Affiliate badges, the logo of the organization an account belongs to (like
// Telegram's next to @durov), only come from Twitter's embed endpoint, since
// FxTwitter leaves them out. This loads one tweet from it, throwing when it
// can't, so callers tell "no badge" apart from "couldn't tell".
async function fetchEmbed(id, signal) {
  // The token Twitter's own embeds send along.
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, { signal });
  const data = res.ok ? await res.json() : null;
  if (!data || !data.user) {
    throw new Error(`Twitter's embed endpoint answered ${res.status} for tweet ${id}.`);
  }
  return data;
}

// The affiliate badge of a user from the embed endpoint, or undefined.
function affiliateOf(user) {
  const label = user && user.highlighted_label;
  const badge = label && label.badge && label.badge.url;
  if (!badge || !isTwimg(badge)) {
    return undefined;
  }
  const url = label.url && label.url.url;
  return {
    name: label.description || '',
    badge,
    url: url && /^https:\/\//.test(url) ? url : undefined,
  };
}

// The affiliate badges of a tweet's author and of the quoted post's author, by
// lowercased handle. They're extras, so any failure just leaves them out.
async function fetchAffiliates(id) {
  const affiliates = new Map();
  try {
    const data = await fetchEmbed(id, AbortSignal.timeout(3000));
    for (const user of [data.user, data.quoted_tweet && data.quoted_tweet.user]) {
      if (user) {
        affiliates.set(user.screen_name.toLowerCase(), affiliateOf(user));
      }
    }
  } catch {}
  return affiliates;
}

// Reply authors' affiliate badges, by lowercased handle. The embed endpoint
// only answers one tweet at a time, so each author takes one lookup (of any of
// their replies), a few at a time, and the answers are remembered for a day
// while this server instance runs. Whatever isn't back after 2 seconds is left
// out, so the replies never wait long; it's tried again on the next load.
const replyAffiliateCache = new Map();
const REPLY_AFFILIATE_TTL = 24 * 60 * 60 * 1000;
const REPLY_AFFILIATE_LOOKUPS = 10;

async function fetchReplyAffiliates(replies) {
  const affiliates = new Map();
  const missing = new Map();
  const now = Date.now();
  for (const reply of replies) {
    const handle = reply.author.screen_name.toLowerCase();
    const cached = replyAffiliateCache.get(handle);
    if (cached && cached.expires > now) {
      affiliates.set(handle, cached.affiliate);
    } else if (!missing.has(handle)) {
      missing.set(handle, reply.id);
    }
  }

  const queue = [...missing];
  const signal = AbortSignal.timeout(2000);
  async function lookUp() {
    while (queue.length > 0) {
      const [handle, id] = queue.shift();
      try {
        const affiliate = affiliateOf((await fetchEmbed(id, signal)).user);
        if (replyAffiliateCache.size >= 5000) {
          replyAffiliateCache.clear();
        }
        replyAffiliateCache.set(handle, { affiliate, expires: Date.now() + REPLY_AFFILIATE_TTL });
        affiliates.set(handle, affiliate);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: REPLY_AFFILIATE_LOOKUPS }, lookUp));
  return affiliates;
}

// Looks up a tweet through the FxTwitter API and returns the address the short
// link points to, plus the tweet details shown when it opens in phib. Tweets
// with a video or GIF point to the direct video.twimg.com file of the requested
// one (without its query string); /photo/N links point to the direct image file
// of that photo; other tweets point to the tweet itself. A signal can give up
// on FxTwitter early.
async function resolveTweet({ id, kind = 'video', index }, { signal } = {}) {
  const [res, affiliates] = await Promise.all([
    fetch(`https://api.fxtwitter.com/status/${id}`, {
      headers: { 'User-Agent': 'phib' },
      signal,
    }),
    fetchAffiliates(id),
  ]);
  const data = await res.json().catch(() => null);
  if (!data || !data.tweet) {
    throw new TwitterError('That tweet could not be found.');
  }

  const { tweet } = data;
  const media = (tweet.media && tweet.media.all) || [];
  const videos = media.filter((m) => m.type === 'video' || m.type === 'gif');
  const photos = media.filter((m) => m.type === 'photo' && m.url && isTwimg(m.url));

  let url = tweet.url;
  let video = null;
  let photoIndex;
  if (kind === 'photo') {
    const picked = photos[index] || photos[0];
    if (picked) {
      const direct = new URL(picked.url);
      direct.search = '';
      url = direct.toString();
      photoIndex = photos.indexOf(picked);
    }
  } else {
    const picked = videos[index] || videos[0];
    video = picked && picked.url && isTwimg(picked.url) ? picked : null;
    if (video) {
      const direct = new URL(video.url);
      direct.search = '';
      url = direct.toString();
    }
  }

  return {
    url,
    tweet: {
      id: tweet.id,
      url: tweet.url,
      text: tweet.text,
      createdAt: new Date(tweet.created_timestamp * 1000).toISOString(),
      author: {
        name: tweet.author.name,
        handle: tweet.author.screen_name,
        avatar: tweet.author.avatar_url,
        url: tweet.author.url,
        verified: checkmark(tweet.author.verification),
        affiliate: affiliates.get(tweet.author.screen_name.toLowerCase()),
      },
      stats: {
        replies: tweet.replies,
        retweets: tweet.retweets,
        likes: tweet.likes,
        views: tweet.views,
      },
      video: video
        ? {
            thumbnail: video.thumbnail_url,
            duration: video.duration,
            width: video.width,
            height: video.height,
          }
        : undefined,
      photos:
        !video && photos.length > 0
          ? photos.map((p) => ({ url: p.url, width: p.width, height: p.height }))
          : undefined,
      // Which of the photos a /photo/N link picked, so the page can mark it.
      photoIndex: !video && photoIndex !== undefined ? photoIndex : undefined,
      quote: tweet.quote ? summarizeQuote(tweet.quote, affiliates) : undefined,
    },
  };
}

// The quoted post shown inside a tweet. Its videos only show their thumbnail;
// the quote links to its own phib page, where they play.
function summarizeQuote(quote, affiliates) {
  const media = (quote.media && quote.media.all) || [];
  const images = media
    .map((m) => ({ url: m.type === 'photo' ? m.url : m.thumbnail_url, width: m.width, height: m.height }))
    .filter((image) => image.url && isTwimg(image.url));
  return {
    id: quote.id,
    url: quote.url,
    text: quote.text,
    createdAt: new Date(quote.created_timestamp * 1000).toISOString(),
    author: {
      name: quote.author.name,
      handle: quote.author.screen_name,
      avatar: quote.author.avatar_url,
      verified: checkmark(quote.author.verification),
      affiliate: affiliates.get(quote.author.screen_name.toLowerCase()),
    },
    images: images.length > 0 ? images : undefined,
  };
}

// A /photo/N link shares just that photo, so only it is shown.
function shownPhotos(tweet) {
  if (tweet.photoIndex == null) {
    return tweet.photos;
  }
  return [tweet.photos[Math.min(tweet.photoIndex, tweet.photos.length - 1)]];
}

// The picture that stands for a tweet in link previews and the history. A
// /photo/N link stands for that photo.
function tweetThumbnail(tweet) {
  if (tweet.video) {
    return tweet.video.thumbnail;
  }
  if (tweet.photos) {
    return shownPhotos(tweet)[0].url;
  }
  return tweet.author.avatar;
}

// Returns the top replies of a tweet, along with some replies to those replies.
// parentId says which post each one answers, so the page can nest them, and
// replyCount how many answers it has in all. FxTwitter's reply paging currently
// answers every cursor with a 404, so only the first page is available.
async function fetchReplies(id) {
  const res = await fetch(`https://api.fxtwitter.com/2/conversation/${id}`, {
    headers: { 'User-Agent': 'phib' },
  });
  const data = await res.json().catch(() => null);
  if (!data || data.code !== 200) {
    throw new TwitterError('Could not load replies.');
  }

  const replies = data.replies || [];
  const affiliates = await fetchReplyAffiliates(replies);
  return replies.map((reply) => ({
    id: reply.id,
    url: reply.url,
    // Drop the leading @mentions Twitter adds to every reply, as x.com does.
    text: reply.text.replace(/^(@\w+\s+)+/, ''),
    createdAt: new Date(reply.created_timestamp * 1000).toISOString(),
    likes: reply.likes,
    replyCount: reply.replies || 0,
    parentId: reply.replying_to ? reply.replying_to.status : id,
    author: {
      name: reply.author.name,
      handle: reply.author.screen_name,
      avatar: reply.author.avatar_url,
      verified: checkmark(reply.author.verification),
      affiliate: affiliates.get(reply.author.screen_name.toLowerCase()),
    },
  }));
}

module.exports = { parseStatus, resolveTweet, tweetThumbnail, shownPhotos, fetchReplies, TwitterError, isTwimg, mediaUrl };
