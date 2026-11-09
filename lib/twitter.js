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

// Looks up a tweet through the FxTwitter API and returns the address the short
// link points to, plus the tweet details shown when it opens in phib. Tweets
// with a video or GIF point to the direct video.twimg.com file of the requested
// one (without its query string); /photo/N links point to the direct image file
// of that photo; other tweets point to the tweet itself.
async function resolveTweet({ id, kind = 'video', index }) {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
    headers: { 'User-Agent': 'phib' },
  });
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
      quote: tweet.quote ? summarizeQuote(tweet.quote) : undefined,
    },
  };
}

// The quoted post shown inside a tweet. Its videos only show their thumbnail;
// the quote links to its own phib page, where they play.
function summarizeQuote(quote) {
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

  return (data.replies || []).map((reply) => ({
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
    },
  }));
}

module.exports = { parseStatus, resolveTweet, tweetThumbnail, shownPhotos, fetchReplies, TwitterError, isTwimg, mediaUrl };
