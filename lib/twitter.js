const TWITTER_HOSTS = ['twitter.com', 'x.com', 'mobile.twitter.com', 'mobile.x.com'];

// Returns { id, index } for tweet links, where index is the 0-based video
// picked by a trailing /video/N (defaults to the first video).
function parseStatus(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!TWITTER_HOSTS.includes(host)) {
    return null;
  }
  const match = url.pathname.match(/\/status\/(\d+)(?:\/video\/(\d+))?/);
  if (!match) {
    return null;
  }
  return { id: match[1], index: match[2] ? Math.max(Number(match[2]) - 1, 0) : 0 };
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

// Looks up a tweet through the FxTwitter API and returns the direct
// video.twimg.com file of the requested video or GIF (without its query string),
// plus the tweet details shown alongside the short link.
async function resolveTwitterVideo({ id, index }) {
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
  const video = videos[index] || videos[0];

  if (!video || !video.url || !isTwimg(video.url)) {
    throw new TwitterError('That tweet has no video.');
  }
  const direct = new URL(video.url);
  direct.search = '';

  return {
    url: direct.toString(),
    tweet: {
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
      video: {
        thumbnail: video.thumbnail_url,
        duration: video.duration,
        width: video.width,
        height: video.height,
      },
    },
  };
}

module.exports = { parseStatus, resolveTwitterVideo, TwitterError, isTwimg, mediaUrl };
