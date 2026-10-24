const YOUTUBE_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];
const VIDEO_ID = /^[\w-]{11}$/;

// Reads t=90, t=1m30s or start=90 into seconds.
function parseStart(value) {
  if (!value) {
    return 0;
  }
  if (/^\d+s?$/.test(value)) {
    return parseInt(value, 10);
  }
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) {
    return 0;
  }
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

// Returns { id, start, short } for YouTube video links, where start is the
// time in seconds the video opens at and short marks a vertical Short.
function parseVideo(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id;
  let short = false;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.includes(host)) {
    const match = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/]+)/);
    if (match) {
      id = match[2];
      short = match[1] === 'shorts';
    } else if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    }
  }
  if (!id || !VIDEO_ID.test(id)) {
    return null;
  }
  return { id, start: parseStart(url.searchParams.get('t') || url.searchParams.get('start')), short };
}

class YouTubeError extends Error {}

// Looks up a video through YouTube's oEmbed endpoint, which needs no API key.
// The short link points to the watch page; the details are shown when it opens
// in phib.
async function resolveVideo({ id, start, short }) {
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`);
  const data = res.ok ? await res.json().catch(() => null) : null;
  if (!data) {
    throw new YouTubeError('That video could not be found, or it cannot be embedded.');
  }

  const url = short ? `https://www.youtube.com/shorts/${id}` : start ? `${watchUrl}&t=${start}s` : watchUrl;
  return {
    url,
    youtube: {
      id,
      url,
      title: data.title,
      author: { name: data.author_name, url: data.author_url },
      thumbnail: data.thumbnail_url,
      start: start || undefined,
      short: short || undefined,
    },
  };
}

function embedUrl(video) {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${video.id}`);
  if (video.start) {
    url.searchParams.set('start', video.start);
  }
  return url.toString();
}

module.exports = { parseVideo, resolveVideo, embedUrl, YouTubeError, VIDEO_ID };
