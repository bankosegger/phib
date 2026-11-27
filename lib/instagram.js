// Instagram posts and reels, looked up the way cobalt (https://cobalt.tools)
// does: without logging in, through Instagram's mobile API, then the post's
// embed page, then the web app's GraphQL API, each tried in turn until one
// answers with the post. With a logged-in session cookie in INSTAGRAM_COOKIE,
// each is tried again with it, for posts Instagram won't show logged-out
// visitors or when it turns those away.
//
// Instagram's media addresses are signed and stop working after a few days
// (see expires), so short links point to the post and its details are looked
// up again once they're about to expire (see refreshInstagram in server.js).
// Its pictures and videos refuse to load on other sites, so pages load them
// through phib's /media proxy.

const crypto = require('crypto');

const INSTAGRAM_HOSTS = ['instagram.com', 'instagr.am', 'ddinstagram.com', 'd.ddinstagram.com', 'g.ddinstagram.com'];

// How long phib waits for Instagram in all, and for any one request, so one
// that hangs leaves time to try the next way.
const TIMEOUT = 8000;
const STEP_TIMEOUT = 4000;

// Bumped whenever short links start storing more of a post. Links saved with
// an older version are looked up again the first time they open.
const INSTAGRAM_VERSION = 1;
// Saved posts are looked up again this long before their media addresses stop
// working, so a video started from the page can play to the end.
const REFRESH_MARGIN = 30 * 60 * 1000;
// How long media addresses are assumed to work when they don't say.
const DEFAULT_LIFETIME = 24 * 60 * 60 * 1000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

// What Instagram's Android app sends, which its mobile API expects.
const MOBILE_HEADERS = {
  'User-Agent':
    'Instagram 275.0.0.27.98 Android (33/13; 280dpi; 720x1423; Xiaomi; Redmi 7; onclite; qcom; en_US; 458229237)',
  'Accept-Language': 'en-US',
  'X-IG-App-Locale': 'en_US',
  'X-IG-Device-Locale': 'en_US',
  'X-IG-Mapped-Locale': 'en_US',
  'X-FB-HTTP-Engine': 'Liger',
  'X-FB-Client-IP': 'True',
  'X-FB-Server-Cluster': 'True',
};

// What a browser sends when it opens a page on instagram.com.
const PAGE_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'max-age=0',
  Dnt: '1',
  Priority: 'u=0, i',
  'Sec-Ch-Ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': BROWSER_UA,
};

// Instagram usernames: letters, digits, _ and ., up to 30 characters.
const USERNAME = /^[\w.]{1,30}$/;

// Returns { shortcode } for links to Instagram posts and reels, { share } for
// the share links the app hands out (instagram.com/share/...), which redirect
// to one, and null for anything else, like profiles and stories.
function parseInstagram(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!INSTAGRAM_HOSTS.includes(host)) {
    return null;
  }
  // Share links come first, since they look like a post link under a
  // profile (instagram.com/<username>/p/...) whose username is "share".
  const share = url.pathname.match(/^\/share\/(?:(?:p|reels?)\/)?([\w-]{1,64})\/?$/);
  if (share) {
    return { share: share[1] };
  }
  const post = url.pathname.match(/^\/(?:[\w.]{1,30}\/)?(?:p|reels?|tv)\/([\w-]{1,64})(?:\/|$)/);
  // instagram.com/reels/audio/<id> is the page of a sound, not a reel.
  if (!post || post[1] === 'audio') {
    return null;
  }
  return { shortcode: post[1] };
}

function isInstagramCdn(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === 'https:' &&
    (host === 'cdninstagram.com' || host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net'))
  );
}

// The address when it's a file on Instagram's media servers, otherwise
// undefined. Only those end up in pages, and only those load through /media.
function cdn(value) {
  try {
    return typeof value === 'string' && isInstagramCdn(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// Thrown when a post can't be shown: it doesn't exist, was deleted or isn't
// public. Instagram failing or turning phib away throws a plain Error
// instead, so pages can say "try again" rather than "not found".
class InstagramError extends Error {}

// Gives up on one request after STEP_TIMEOUT, or on all of them when signal
// says so.
function stepSignal(signal) {
  return AbortSignal.any([signal, AbortSignal.timeout(STEP_TIMEOUT)]);
}

// The answer as JSON, or null when it isn't (like a login page).
async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// One value from a cookie header, like its csrftoken.
function cookieValue(cookie, name) {
  const match = cookie && cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : undefined;
}

// Share links ------------------------------------------------------------------

// The shortcode of the post a share link leads to. Instagram answers with a
// redirect when it takes the request for a command line tool's; browsers get
// a page instead.
async function resolveShare(id, signal) {
  const res = await fetch(`https://www.instagram.com/share/${encodeURIComponent(id)}/`, {
    headers: { 'User-Agent': 'curl/7.88.1' },
    redirect: 'manual',
    signal: stepSignal(signal),
  });
  await res.body?.cancel().catch(() => {});
  if (res.status === 404) {
    throw new InstagramError('That share link could not be found.');
  }
  // No redirect, or one to the login page, means Instagram turned phib away.
  const location = res.headers.get('location');
  if (!location || /\/accounts\/login/.test(location)) {
    throw new Error(`Instagram answered ${res.status} for share link ${id}${location ? `, sending it to ${location}` : ''}.`);
  }
  let post = null;
  try {
    post = parseInstagram(new URL(location, 'https://www.instagram.com/').toString());
  } catch {}
  if (!post || !post.shortcode) {
    throw new InstagramError('That share link does not lead to a post.');
  }
  return post.shortcode;
}

// The post ---------------------------------------------------------------------

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function size(value) {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function plainText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// A time in seconds since 1970 as an ISO date, or undefined when it's missing.
function isoTime(seconds) {
  const date = new Date(typeof seconds === 'number' ? seconds * 1000 : NaN);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// The biggest of a list of versions of a picture or video.
function largest(list) {
  let best;
  for (const item of Array.isArray(list) ? list : []) {
    if (item && (!best || (item.width || 0) * (item.height || 0) > (best.width || 0) * (best.height || 0))) {
      best = item;
    }
  }
  return best;
}

// The @mentions and #hashtags of a caption, linked as on instagram.com. Like
// there, web addresses in captions stay text. Hashtags need a letter, and
// usernames don't end with a full stop, which ends the sentence instead.
const CAPTION_LINKS = [
  {
    pattern: /(?<![\w.@])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)/g,
    href: (name) => `https://www.instagram.com/${name}/`,
  },
  {
    pattern: /(?<![\w&#])[#＃]((?=[\p{L}\p{M}\p{N}_]*[\p{L}\p{M}])[\p{L}\p{M}\p{N}_]+)/gu,
    href: (tag) => `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
  },
];

function captionLinks(text) {
  const links = [];
  for (const { pattern, href } of CAPTION_LINKS) {
    for (const match of text.matchAll(pattern)) {
      links.push({ start: match.index, end: match.index + match[0].length, url: href(match[1]) });
    }
  }
  links.sort((a, b) => a.start - b.start);
  return links.length > 0 ? links : undefined;
}

// When the first of the post's media addresses stops working. Instagram signs
// each with its expiry time, in hexadecimal seconds, as oe.
function expiryOf(urls) {
  let earliest = Infinity;
  for (const value of urls) {
    const oe = value ? new URL(value).searchParams.get('oe') : null;
    const time = oe && /^[\da-f]{1,10}$/i.test(oe) ? parseInt(oe, 16) * 1000 : NaN;
    if (time > Date.now()) {
      earliest = Math.min(earliest, time);
    }
  }
  return new Date(Number.isFinite(earliest) ? earliest : Date.now() + DEFAULT_LIFETIME).toISOString();
}

// The post as phib keeps it, from what one of the ways of looking it up
// found. undefined when that's missing something phib needs, like the
// address of a video, so the next way gets a try.
function buildPost(found) {
  const { owner } = found;
  if (
    typeof found.shortcode !== 'string' ||
    !/^[\w-]{1,64}$/.test(found.shortcode) ||
    typeof owner.username !== 'string' ||
    !USERNAME.test(owner.username) ||
    found.media.length === 0 ||
    found.media.some((item) => !item)
  ) {
    return undefined;
  }
  const text = typeof found.caption === 'string' ? found.caption.trim() : '';
  const avatar = owner.avatars.map(cdn).find(Boolean);
  const { stats } = found;
  return {
    v: INSTAGRAM_VERSION,
    shortcode: found.shortcode,
    url: `https://www.instagram.com/${found.reel ? 'reel' : 'p'}/${found.shortcode}/`,
    text,
    links: captionLinks(text),
    createdAt: isoTime(found.takenAt),
    author: {
      name: plainText(owner.name) || owner.username,
      handle: owner.username,
      avatar,
      url: `https://www.instagram.com/${owner.username}/`,
      verified: owner.verified === true ? 'blue' : null,
    },
    location: plainText(found.location),
    stats: {
      likes: found.countsHidden ? undefined : count(stats.likes),
      comments: count(stats.comments),
      views: found.countsHidden ? undefined : count(stats.views),
    },
    media: found.media,
    expires: expiryOf([avatar, ...found.media.flatMap((item) => [item.url, item.thumbnail])]),
  };
}

// A photo or video in the shape of Instagram's web API (GraphQL and the embed
// page). A video without its address is null, rather than passed off as a
// photo of its first frame.
function graphItem(node) {
  if (!node) {
    return null;
  }
  const dimensions = node.dimensions || {};
  const picture = cdn(node.display_url) || cdn(node.thumbnail_src);
  const item = {
    width: size(dimensions.width),
    height: size(dimensions.height),
    alt: plainText(node.accessibility_caption),
  };
  if (node.is_video) {
    const url = cdn(node.video_url);
    return url ? { type: 'video', url, thumbnail: picture, duration: size(node.video_duration), ...item } : null;
  }
  return picture ? { type: 'photo', url: picture, ...item } : null;
}

function fromGraph(media) {
  const owner = media.owner || {};
  const sidecar = media.edge_sidecar_to_children && media.edge_sidecar_to_children.edges;
  const children = Array.isArray(sidecar) ? sidecar.map((edge) => edge && edge.node) : [];
  const captions = media.edge_media_to_caption && media.edge_media_to_caption.edges;
  const caption = Array.isArray(captions) && captions[0] && captions[0].node;
  const likes = media.edge_media_preview_like || media.edge_liked_by || {};
  const comments = media.edge_media_to_parent_comment || media.edge_media_preview_comment || media.edge_media_to_comment || {};
  return buildPost({
    shortcode: media.shortcode,
    reel: media.product_type === 'clips',
    caption: caption && caption.text,
    takenAt: media.taken_at_timestamp,
    owner: {
      username: owner.username,
      name: owner.full_name,
      avatars: [owner.profile_pic_url],
      verified: owner.is_verified,
    },
    media: (children.length > 0 ? children : [media]).map(graphItem),
    stats: { likes: likes.count, comments: comments.count, views: media.video_play_count ?? media.video_view_count },
    countsHidden: media.like_and_view_counts_disabled === true,
    location: media.location && media.location.name,
  });
}

// A photo or video in the shape of Instagram's mobile API.
function apiItem(item) {
  if (!item) {
    return null;
  }
  const picture = largest(item.image_versions2 && item.image_versions2.candidates);
  const pictureUrl = picture && cdn(picture.url);
  const common = {
    width: size(item.original_width) || size(picture && picture.width),
    height: size(item.original_height) || size(picture && picture.height),
    alt: plainText(item.accessibility_caption),
  };
  if (item.media_type === 2 || Array.isArray(item.video_versions)) {
    const video = largest(item.video_versions);
    const url = video && cdn(video.url);
    if (!url) {
      return null;
    }
    return {
      type: 'video',
      url,
      thumbnail: pictureUrl,
      duration: size(item.video_duration),
      ...common,
      width: common.width || size(video.width),
      height: common.height || size(video.height),
    };
  }
  return pictureUrl ? { type: 'photo', url: pictureUrl, ...common } : null;
}

function fromApi(item) {
  const user = item.user || item.owner || {};
  const carousel = Array.isArray(item.carousel_media) ? item.carousel_media : [];
  return buildPost({
    shortcode: item.code,
    reel: item.product_type === 'clips',
    caption: item.caption && item.caption.text,
    takenAt: item.taken_at,
    owner: {
      username: user.username,
      name: user.full_name,
      avatars: [user.hd_profile_pic_url_info && user.hd_profile_pic_url_info.url, user.profile_pic_url],
      verified: user.is_verified,
    },
    media: (carousel.length > 0 ? carousel : [item]).map(apiItem),
    stats: { likes: item.like_count, comments: item.comment_count, views: item.play_count ?? item.ig_play_count ?? item.view_count },
    countsHidden: item.like_and_view_counts_disabled === true,
    location: item.location && item.location.name,
  });
}

// The ways of looking a post up ---------------------------------------------------
//
// Each answers { post } when it found the post, { missing: true } when
// Instagram said there's no such post (or none it shows), or { failed } with
// what went wrong otherwise.

// Instagram's mobile app API: its oEmbed endpoint turns the shortcode into the
// post's media id, which its media info endpoint then describes.
async function fromMobileApi(shortcode, { cookie, signal }) {
  const headers = { ...MOBILE_HEADERS, ...(cookie && { Cookie: cookie }) };
  const oembedUrl = new URL('https://i.instagram.com/api/v1/oembed/');
  oembedUrl.searchParams.set('url', `https://www.instagram.com/p/${shortcode}/`);
  const oembed = await fetch(oembedUrl, { headers, redirect: 'manual', signal: stepSignal(signal) });
  const data = await readJson(oembed);
  if (oembed.status === 404) {
    return { missing: true };
  }
  const mediaId = data && data.media_id;
  if (!/^\d{1,30}(?:_\d{1,30})?$/.test(String(mediaId))) {
    return { failed: `oEmbed answered ${oembed.status}` };
  }
  const info = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
    headers,
    redirect: 'manual',
    signal: stepSignal(signal),
  });
  const body = await readJson(info);
  const item = body && Array.isArray(body.items) ? body.items[0] : undefined;
  if (!item) {
    return { failed: `media info answered ${info.status}` };
  }
  const post = fromApi(item);
  return post ? { post } : { failed: 'the post came without its media' };
}

// The page Instagram's embeds load, which carries the post in the shape of its
// older web API.
async function fromEmbed(shortcode, { cookie, signal }) {
  const res = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: { ...PAGE_HEADERS, ...(cookie && { Cookie: cookie }) },
    redirect: 'manual',
    signal: stepSignal(signal),
  });
  const html = await res.text();
  let media;
  try {
    const init = JSON.parse(html.match(/"init",\[\],\[(.*?)\]\],/)[1]);
    const context = JSON.parse(init.contextJSON);
    media = context.gql_data && (context.gql_data.shortcode_media || context.gql_data.xdt_shortcode_media);
  } catch {}
  if (!media) {
    return { failed: `answered ${res.status} without the post` };
  }
  const post = fromGraph(media);
  return post ? { post } : { failed: 'the post came without its media' };
}

// The value of one of the ["Name",[],{...},123] entries in which Instagram's
// pages carry the tokens its web app sends along with its requests.
function pageEntry(html, name) {
  const match = html.match(new RegExp(`\\["${name}",.*?,(\\{.*?\\}),\\d+\\]`));
  try {
    return match ? JSON.parse(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function pageNumber(html, name) {
  const match = html.match(new RegExp(`${name}=(\\d+)`));
  return match && Number(match[1]) ? match[1] : undefined;
}

// The GraphQL query instagram.com's web app loads a post with, sent with the
// tokens the post's page hands out to logged-out visitors.
async function fromGraphql(shortcode, { cookie, signal }) {
  const page = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
    headers: { ...PAGE_HEADERS, ...(cookie && { Cookie: cookie }) },
    redirect: 'manual',
    signal: stepSignal(signal),
  });
  const html = await page.text();
  const site = pageEntry(html, 'SiteData') || {};
  const polaris = pageEntry(html, 'PolarisSiteData') || {};
  const lsd = (pageEntry(html, 'LSD') || {}).token || crypto.randomBytes(8).toString('base64url');
  const csrf = cookieValue(cookie, 'csrftoken') || (pageEntry(html, 'InstagramSecurityConfig') || {}).csrf_token;
  const visitorCookie = [
    csrf && `csrftoken=${csrf}`,
    polaris.device_id && `ig_did=${polaris.device_id}`,
    'wd=1280x720',
    'dpr=2',
    polaris.machine_id && `mid=${polaris.machine_id}`,
    'ig_nrcb=1',
  ]
    .filter(Boolean)
    .join('; ');

  const headers = {
    ...PAGE_HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookie || visitorCookie,
    'X-IG-App-ID': (pageEntry(html, 'DGWWebConfig') || {}).appId || '936619743392459',
    'X-FB-LSD': lsd,
    'X-FB-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
    'X-ASBD-ID': '129477',
  };
  if (csrf) {
    headers['X-CSRFToken'] = csrf;
  }
  const bloks = (pageEntry(html, 'WebBloksVersioningID') || {}).versioningID;
  if (bloks) {
    headers['X-Bloks-Version-Id'] = bloks;
  }

  const body = new URLSearchParams({
    __d: 'www',
    __a: '1',
    __s: `::${Math.random().toString(36).slice(2).replace(/\d/g, '').slice(0, 6)}`,
    __hs: site.haste_session || '20126.HYP:instagram_web_pkg.2.1...0',
    __req: 'b',
    __ccg: 'EXCELLENT',
    __rev: (pageEntry(html, 'InstagramWebPushInfo') || {}).rollout_hash || '1019933358',
    __hsi: site.hsi || '7436540909012459023',
    __dyn: crypto.randomBytes(154).toString('base64url'),
    __csr: crypto.randomBytes(154).toString('base64url'),
    __user: '0',
    __comet_req: pageNumber(html, '__comet_req') || '7',
    av: '0',
    dpr: '2',
    lsd,
    jazoest: pageNumber(html, 'jazoest') || String(Math.floor(Math.random() * 10000)),
    __spin_r: site.__spin_r || '1019933358',
    __spin_b: site.__spin_b || 'trunk',
    __spin_t: site.__spin_t || Math.floor(Date.now() / 1000),
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
    variables: JSON.stringify({
      shortcode,
      fetch_tagged_user_count: null,
      hoisted_comment_id: null,
      hoisted_reply_id: null,
    }),
    server_timestamps: 'true',
    doc_id: '8845758582119845',
  });

  const res = await fetch('https://www.instagram.com/graphql/query', {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: stepSignal(signal),
  });
  const data = await readJson(res);
  if (!data || !data.data || !('xdt_shortcode_media' in data.data)) {
    return { failed: `answered ${res.status}` };
  }
  // null is how Instagram says the post doesn't exist, or isn't public.
  if (!data.data.xdt_shortcode_media) {
    return { missing: true };
  }
  const post = fromGraph(data.data.xdt_shortcode_media);
  return post ? { post } : { failed: 'the post came without its media' };
}

const METHODS = [
  ['mobile API', fromMobileApi],
  ['embed page', fromEmbed],
  ['GraphQL', fromGraphql],
];

// Looks up an Instagram post or reel and returns the address the short link
// points to (the post itself, since its media addresses expire) and the
// details phib shows: author, caption, every photo and video, and counts. Each
// way of looking it up is tried in turn, first logged out and then with the
// INSTAGRAM_COOKIE session when there is one, as cobalt does. When none finds
// it, the error says what each one got, for the logs.
async function resolveInstagram({ shortcode, share }, { signal = AbortSignal.timeout(TIMEOUT) } = {}) {
  const code = shortcode || (await resolveShare(share, signal));
  const cookie = (process.env.INSTAGRAM_COOKIE || '').trim();
  const sessions = cookie ? [undefined, cookie] : [undefined];
  const notes = [];
  let missing = false;
  for (const [name, method] of METHODS) {
    for (const session of sessions) {
      let result;
      try {
        result = await method(code, { cookie: session, signal });
      } catch (err) {
        if (signal.aborted) {
          throw new Error(`Instagram took too long for post ${code} (${[...notes, `${name}: ${err.message}`].join('; ')}).`);
        }
        result = { failed: err.message };
      }
      if (result.post) {
        return { url: result.post.url, instagram: result.post };
      }
      missing = missing || Boolean(result.missing);
      notes.push(`${name}${session ? ' with the cookie' : ''}: ${result.missing ? 'no such post' : result.failed}`);
    }
  }
  if (missing) {
    throw new InstagramError('That post could not be found. It may have been deleted, or be private.');
  }
  throw new Error(`Instagram did not answer for post ${code} (${notes.join('; ')}).`);
}

// Whether a saved post should be looked up again before it's shown: it was
// saved by an older version of phib, or its media addresses expire soon.
function isStale(post) {
  return post.v !== INSTAGRAM_VERSION || !(Date.parse(post.expires) - REFRESH_MARGIN > Date.now());
}

module.exports = {
  parseInstagram,
  resolveInstagram,
  captionLinks,
  isInstagramCdn,
  isStale,
  InstagramError,
  INSTAGRAM_VERSION,
  BROWSER_UA,
};
