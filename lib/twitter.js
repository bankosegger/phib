const { parseVideo } = require('./youtube');

const TWITTER_HOSTS = ['twitter.com', 'x.com', 'mobile.twitter.com', 'mobile.x.com'];
const FXTWITTER = 'https://api.fxtwitter.com';
const HEADERS = { 'User-Agent': 'phib' };

// Bumped whenever short links start storing more of a post. Links saved with an
// older version are looked up again the first time they open (see refreshTweet
// in server.js), so they show everything newer links do.
const TWEET_VERSION = 2;

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

// The address when it's a Twitter media file, otherwise undefined.
function twimg(value) {
  try {
    return typeof value === 'string' && isTwimg(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isWebUrl(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
}

function withoutQuery(value) {
  const url = new URL(value);
  url.search = '';
  return url.toString();
}

class TwitterError extends Error {}

// The color of an account's verified checkmark, as on x.com: grey for
// governments, gold for organizations and blue for everyone else. Unverified
// accounts get null rather than nothing, so stored links tell them apart from
// links saved before badges were.
function checkmark(verification) {
  if (!verification || !verification.verified) {
    return null;
  }
  if (verification.type === 'government') {
    return 'grey';
  }
  return verification.type === 'organization' || verification.type === 'business' ? 'gold' : 'blue';
}

// Text ------------------------------------------------------------------------

// How x.com shows a link it has no display form for: without the scheme or
// www, cut short after 30 characters.
function displayUrl(url) {
  const bare = url.replace(/^https?:\/\/(?:www\.)?/i, '');
  return bare.length > 30 ? `${bare.slice(0, 29)}…` : bare;
}

function countOf(value, char) {
  return value.split(char).length - 1;
}

// Drops the punctuation that ends a sentence rather than a link, keeping
// closing brackets the link itself opened.
function trimUrl(url) {
  let end = url.length;
  for (;;) {
    const part = url.slice(0, end);
    const last = part[end - 1];
    const unbalanced =
      (last === ')' && countOf(part, '(') < countOf(part, ')')) ||
      (last === ']' && countOf(part, '[') < countOf(part, ']'));
    if (!'.,;:!?…\'"*'.includes(last) && !unbalanced) {
      return part;
    }
    end -= 1;
  }
}

const URL_PATTERN = /https?:\/\/[^\s<>"'“”‘’«»]+/gi;

// What else x.com links in a post, and where to: @mentions, #hashtags (which
// need a letter) and $cashtags.
const TEXT_LINKS = [
  { pattern: /(?<![\w@/])@(\w{1,15})(?![\w@])/g, href: (name) => `https://x.com/${name}` },
  {
    pattern: /(?<![\w&/#$])[#＃]((?=[\p{L}\p{M}\p{N}_]*[\p{L}\p{M}])[\p{L}\p{M}\p{N}_]+)/gu,
    href: (tag) => `https://x.com/hashtag/${encodeURIComponent(tag)}`,
  },
  {
    pattern: /(?<![\w$])\$([A-Za-z]{1,6}(?:[._][A-Za-z]{1,2})?)(?![\w$])/g,
    href: (tag) => `https://x.com/search?q=${encodeURIComponent(`$${tag}`)}`,
  },
];

// How many characters of @mentions start a reply. x.com hides them, showing
// "Replying to" instead. Twitter's display range says where the text proper
// starts; without one, every leading mention counts.
function mentionPrefix(text, displayStart) {
  if (displayStart === 0) {
    return 0;
  }
  if (displayStart > 0 && /^(?:@\w{1,15}\s*)+$/.test(text.slice(0, displayStart))) {
    return displayStart;
  }
  const match = text.match(/^(?:@\w{1,15}(?:\s+|$))+/);
  return match ? match[0].length : 0;
}

// A post's text as x.com shows it, and the ranges in it that link somewhere.
// FxTwitter puts each link's full address back in place of its t.co link and
// lists, among the facets, the shorter form x.com displays; links get that
// form, and @mentions, #hashtags and $cashtags are linked too. Replies lose
// their leading @mentions, and posts quoting another lose the link to it,
// which shows as a box underneath. FxTwitter's facet offsets don't line up with
// its text (they count characters differently, and long posts are off
// entirely), so links are found by their text instead.
//
// Returns { text, links }, where each link is { start, end, url } with
// offsets into text as JavaScript counts them.
function richText(value, facets, { reply = false, displayStart, quoteId } = {}) {
  let text = typeof value === 'string' ? value : '';
  if (reply) {
    text = text.slice(mentionPrefix(text, displayStart));
  }
  if (/^\d+$/.test(quoteId)) {
    text = text.replace(new RegExp(`\\s*https?://\\S+/status/${quoteId}(?:[/?#]\\S*)?\\s*$`), '');
  }
  text = text.trim();

  const shortened = new Map();
  for (const facet of Array.isArray(facets) ? facets : []) {
    if (facet && facet.type === 'url' && isWebUrl(facet.replacement) && !shortened.has(facet.replacement)) {
      shortened.set(facet.replacement, facet.display || displayUrl(facet.replacement));
    }
  }
  const known = [...shortened.keys()].sort((a, b) => b.length - a.length);

  let out = '';
  const links = [];
  let pos = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match.index < pos) {
      continue;
    }
    const url = known.find((candidate) => text.startsWith(candidate, match.index)) || trimUrl(match[0]);
    const display = shortened.get(url) || displayUrl(url);
    out += text.slice(pos, match.index);
    links.push({ start: out.length, end: out.length + display.length, url });
    out += display;
    pos = match.index + url.length;
  }
  out += text.slice(pos);

  for (const { pattern, href } of TEXT_LINKS) {
    for (const match of out.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!links.some((link) => start < link.end && end > link.start)) {
        links.push({ start, end, url: href(match[1]) });
      }
    }
  }
  links.sort((a, b) => a.start - b.start);
  return { text: out, links: links.length > 0 ? links : undefined };
}

// The post in an answer from FxTwitter's v2 API. Some requests get the answer
// in its v1 shape instead (translations from Node's fetch, for one), with the
// post under "tweet" and a few fields named the old way.
function statusOf(data) {
  if (!data) {
    return null;
  }
  if (data.status) {
    return data.status;
  }
  const { tweet } = data;
  if (!tweet) {
    return null;
  }
  return {
    ...tweet,
    reposts: tweet.reposts ?? tweet.retweets,
    replying_to:
      typeof tweet.replying_to === 'string'
        ? { screen_name: tweet.replying_to, status: tweet.replying_to_status }
        : tweet.replying_to,
  };
}

// The text of a post from FxTwitter.
function postText(status) {
  const raw = status.raw_text || {};
  return richText(status.text, raw.facets, {
    reply: Boolean(status.replying_to),
    displayStart: Array.isArray(raw.display_text_range) ? raw.display_text_range[0] : undefined,
    quoteId: status.quote && status.quote.id,
  });
}

// Twitter's embed endpoint ----------------------------------------------------

// Twitter's embed endpoint knows a few things FxTwitter leaves out: affiliate
// badges, the logo of the organization an account belongs to (like Telegram's
// next to @durov), square avatars, edits and the post a reply answers. This
// loads one tweet from it, throwing when it can't, so callers tell "no badge"
// apart from "couldn't tell".
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
  if (!badge || !twimg(badge)) {
    return undefined;
  }
  const url = label.url && label.url.url;
  return {
    name: label.description || '',
    badge,
    url: url && /^https:\/\//.test(url) ? url : undefined,
  };
}

// What phib takes of a user from the embed endpoint: their affiliate badge, and
// whether x.com shows their avatar square, as it does for businesses.
function userExtras(user) {
  return {
    affiliate: affiliateOf(user),
    shape: user.profile_image_shape === 'Square' ? 'square' : undefined,
  };
}

// What only the embed endpoint tells about a tweet: the extras of its author,
// of the quoted post's author and of the replied-to post's author (by
// lowercased handle), whether it was edited, the id of its latest version when
// this one is outdated, and the post it replies to. They're extras, so any
// failure just leaves them out.
async function fetchEmbedDetails(id) {
  const details = { users: new Map() };
  try {
    const data = await fetchEmbed(id, AbortSignal.timeout(3000));
    for (const post of [data, data.quoted_tweet, data.parent]) {
      if (post && post.user) {
        details.users.set(post.user.screen_name.toLowerCase(), userExtras(post.user));
      }
    }
    const edits = (data.edit_control && data.edit_control.edit_tweet_ids) || [];
    const latest = edits[edits.length - 1];
    details.edited = data.isEdited === true || undefined;
    details.latestId = data.isStaleEdit && latest && latest !== id ? latest : undefined;
    details.parent = data.parent;
  } catch {}
  return details;
}

// Reply authors' extras, by lowercased handle. The embed endpoint only answers
// one tweet at a time, so each author takes one lookup (of any of their
// replies), a few at a time, and the answers are remembered for a day while
// this server instance runs. Whatever isn't back after 2 seconds is left out,
// so the replies never wait long; it's tried again on the next load.
const replyExtrasCache = new Map();
const REPLY_EXTRAS_TTL = 24 * 60 * 60 * 1000;
const REPLY_EXTRAS_LOOKUPS = 10;

async function fetchReplyExtras(replies) {
  const extras = new Map();
  const missing = new Map();
  const now = Date.now();
  for (const reply of replies) {
    const handle = reply.author.screen_name.toLowerCase();
    const cached = replyExtrasCache.get(handle);
    if (cached && cached.expires > now) {
      extras.set(handle, cached.extras);
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
        const found = userExtras((await fetchEmbed(id, signal)).user);
        if (replyExtrasCache.size >= 5000) {
          replyExtrasCache.clear();
        }
        replyExtrasCache.set(handle, { extras: found, expires: Date.now() + REPLY_EXTRAS_TTL });
        extras.set(handle, found);
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: REPLY_EXTRAS_LOOKUPS }, lookUp));
  return extras;
}

function unescapeEntities(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Posts from the embed endpoint come in Twitter's older format: the text keeps
// its t.co links (and escapes &, < and >), and lists each link's full and
// display forms.
function embedText(post) {
  let text = unescapeEntities(typeof post.text === 'string' ? post.text : '');
  const entities = post.entities || {};
  for (const media of [...(entities.media || []), ...(post.mediaDetails || [])]) {
    if (typeof media.url === 'string' && media.url) {
      text = text.split(media.url).join('');
    }
  }
  const facets = [];
  for (const link of entities.urls || []) {
    if (typeof link.url === 'string' && link.url && isWebUrl(link.expanded_url)) {
      text = text.split(link.url).join(link.expanded_url);
      facets.push({ type: 'url', replacement: link.expanded_url, display: link.display_url });
    }
  }
  return richText(text, facets, {
    reply: Boolean(post.in_reply_to_status_id_str || post.in_reply_to_screen_name),
    displayStart: Array.isArray(post.display_text_range) ? post.display_text_range[0] : undefined,
  });
}

function embedAuthor(user, users) {
  const extras = users.get(user.screen_name.toLowerCase()) || userExtras(user);
  const avatar =
    typeof user.profile_image_url_https === 'string'
      ? user.profile_image_url_https.replace('_normal.', '_200x200.')
      : undefined;
  let verified = null;
  if (user.verified_type === 'Government') {
    verified = 'grey';
  } else if (user.verified_type === 'Business') {
    verified = 'gold';
  } else if (user.is_blue_verified || user.verified) {
    verified = 'blue';
  }
  return {
    name: user.name,
    handle: user.screen_name,
    avatar: twimg(avatar),
    url: `https://x.com/${user.screen_name}`,
    verified,
    affiliate: extras.affiliate,
    shape: extras.shape,
  };
}

// The post a reply answers, from the embed endpoint, shaped like a quoted post.
function summarizeEmbedPost(post, users) {
  if (!post || !post.user || !post.id_str) {
    return undefined;
  }
  const text = embedText(post);
  const images = (post.mediaDetails || [])
    .map((m) => ({
      url: twimg(m.media_url_https),
      width: m.original_info && m.original_info.width,
      height: m.original_info && m.original_info.height,
      alt: m.ext_alt_text || undefined,
      video: m.type === 'video' || m.type === 'animated_gif' || undefined,
    }))
    .filter((image) => image.url);
  const created = new Date(post.created_at);
  return {
    id: post.id_str,
    url: `https://x.com/${post.user.screen_name}/status/${post.id_str}`,
    text: text.text,
    links: text.links,
    createdAt: Number.isNaN(created.getTime()) ? undefined : created.toISOString(),
    author: embedAuthor(post.user, users),
    images: images.length > 0 ? images : undefined,
    stats: {
      replies: post.reply_count ?? post.conversation_count,
      retweets: post.retweet_count,
      likes: post.favorite_count,
    },
    sensitive: post.possibly_sensitive || undefined,
  };
}

// Posts from FxTwitter -------------------------------------------------------

// The MP4 versions of a video in other sizes, best first, for the quality menu;
// undefined when there's only the one.
function variantsOf(video) {
  const variants = [];
  for (const format of video.formats || []) {
    const url = format.container === 'mp4' && (!format.codec || format.codec === 'h264') && twimg(format.url);
    if (!url) {
      continue;
    }
    const size = url.match(/\/(\d+)x(\d+)\//);
    const width = format.width || (size && Number(size[1]));
    const height = format.height || (size && Number(size[2]));
    const direct = withoutQuery(url);
    if (width && height && !variants.some((variant) => variant.url === direct)) {
      variants.push({ url: direct, width, height, bitrate: format.bitrate || 0 });
    }
  }
  variants.sort((a, b) => b.bitrate - a.bitrate);
  return variants.length > 1 ? variants : undefined;
}

// The photos, videos and GIFs of a post, in their order. Videos and GIFs point
// to their direct video.twimg.com files, without the query string.
function mediaOf(status) {
  const media = [];
  for (const item of (status.media && status.media.all) || []) {
    const url = twimg(item.url);
    if (!url) {
      continue;
    }
    const alt = item.altText || undefined;
    if (item.type === 'photo') {
      media.push({ type: 'photo', url, width: item.width, height: item.height, alt });
    } else if (item.type === 'video' || item.type === 'gif') {
      media.push({
        type: item.type,
        url: withoutQuery(url),
        thumbnail: twimg(item.thumbnail_url),
        width: item.width,
        height: item.height,
        duration: item.duration || undefined,
        alt,
        variants: item.type === 'video' ? variantsOf(item) : undefined,
      });
    }
  }
  return media;
}

// Which media item a link points to: the one at a saved short link's address
// (pick), otherwise the Nth photo of a /photo/N link or the Nth video or GIF of
// any other link, falling back to the first. -1 when there's none, as for
// posts with only photos and no /photo/N.
function pickMedia(media, { kind, index, pick }) {
  if (pick) {
    let target;
    try {
      target = withoutQuery(pick);
    } catch {
      return -1;
    }
    return media.findIndex((item) => withoutQuery(item.url) === target);
  }
  const candidates = media
    .map((item, i) => i)
    .filter((i) => (kind === 'photo') === (media[i].type === 'photo'));
  return candidates[index] ?? candidates[0] ?? -1;
}

// A YouTube video the post links to, which x.com plays in place of a link
// preview.
function externalOf(external) {
  if (!external || typeof external.url !== 'string') {
    return undefined;
  }
  let video;
  try {
    video = parseVideo(external.url);
  } catch {
    return undefined;
  }
  if (!video) {
    return undefined;
  }
  const thumbnail = external.thumbnail_url;
  return {
    id: video.id,
    start: video.start || undefined,
    width: external.width,
    height: external.height,
    thumbnail: typeof thumbnail === 'string' && /^https:\/\//i.test(thumbnail) ? thumbnail : undefined,
  };
}

// The preview x.com shows for a link in the post: the page's title,
// description and image.
function cardOf(card) {
  if (!card || !isWebUrl(card.url)) {
    return undefined;
  }
  const imageUrl = twimg(card.image && card.image.url);
  const image = imageUrl
    ? { url: imageUrl, width: card.image.width, height: card.image.height, alt: card.image.alt || undefined }
    : undefined;
  let { domain } = card;
  if (!domain) {
    try {
      domain = new URL(card.url).hostname;
    } catch {}
  }
  return {
    url: card.url,
    title: card.title || undefined,
    description: card.description || undefined,
    domain: domain ? domain.replace(/^www\./, '') : undefined,
    image,
    // Summary cards have a small square image beside the text; the others a
    // wide one above it.
    large: image ? (card.card_name ? card.card_name !== 'summary' : image.width / image.height > 1.3) : undefined,
  };
}

function pollOf(poll) {
  if (!poll || !Array.isArray(poll.choices) || poll.choices.length === 0) {
    return undefined;
  }
  return {
    choices: poll.choices.map((choice) => ({
      label: String(choice.label),
      count: choice.count || 0,
      percentage: choice.percentage || 0,
    })),
    total: poll.total_votes || 0,
    endsAt: poll.ends_at || undefined,
  };
}

// A community note, with its links like the post's.
function noteOf(note) {
  if (!note || typeof note.text !== 'string' || !note.text.trim()) {
    return undefined;
  }
  return richText(note.text, note.facets);
}

function statsOf(status) {
  return {
    replies: status.replies,
    retweets: status.reposts ?? status.retweets,
    likes: status.likes,
    views: status.views,
    quotes: status.quotes,
    bookmarks: status.bookmarks,
  };
}

// What x.com's profile hover card shows: bio, location, website, banner, join
// date and counts.
function profileOf(author) {
  const bio = richText(author.description, author.raw_description && author.raw_description.facets);
  const joined = new Date(author.joined);
  const { website } = author;
  return {
    bio: bio.text ? bio : undefined,
    location: author.location || undefined,
    website:
      website && isWebUrl(website.url)
        ? { url: website.url, display: website.display_url || displayUrl(website.url) }
        : undefined,
    banner: twimg(author.banner_url),
    joined: Number.isNaN(joined.getTime()) ? undefined : joined.toISOString(),
    followers: author.followers,
    following: author.following,
    posts: author.statuses,
  };
}

// users holds the extras from the embed endpoint, by lowercased handle.
function summarizeAuthor(author, users, { profile = false } = {}) {
  const extras = users.get(author.screen_name.toLowerCase()) || {};
  return {
    name: author.name,
    handle: author.screen_name,
    avatar: author.avatar_url,
    url: author.url,
    verified: checkmark(author.verification),
    affiliate: extras.affiliate,
    shape: extras.shape,
    protected: author.protected || undefined,
    profile: profile ? profileOf(author) : undefined,
  };
}

// The quoted post shown inside a tweet, or a note that it's unavailable. Its
// videos only show their thumbnail; the quote links to its own phib page,
// where they play.
function summarizeQuote(quote, users) {
  if (quote.type === 'tombstone' || !quote.author) {
    return { unavailable: true, id: quote.id, message: quote.message || undefined };
  }
  const text = postText(quote);
  const images = mediaOf(quote)
    .map((m) => ({
      url: m.type === 'photo' ? m.url : m.thumbnail,
      width: m.width,
      height: m.height,
      alt: m.alt,
      video: m.type !== 'photo' || undefined,
    }))
    .filter((image) => image.url);
  return {
    id: quote.id,
    url: quote.url,
    text: text.text,
    links: text.links,
    createdAt: new Date(quote.created_timestamp * 1000).toISOString(),
    author: summarizeAuthor(quote.author, users),
    images: images.length > 0 ? images : undefined,
    card: images.length > 0 ? undefined : cardOf(quote.card),
    stats: statsOf(quote),
    sensitive: quote.possibly_sensitive || undefined,
  };
}

function repostedByOf(user) {
  if (!user || !user.screen_name) {
    return undefined;
  }
  return {
    name: user.name,
    handle: user.screen_name,
    url: isWebUrl(user.url) ? user.url : `https://x.com/${user.screen_name}`,
  };
}

// Looks up a tweet through FxTwitter and returns the address the short link
// points to, plus the tweet details shown when it opens in phib. Links point to
// the direct video.twimg.com file of the requested video or GIF (/video/N, the
// first by default), or with /photo/N to the direct image file of that photo;
// posts without one point to the tweet itself. Refreshing a saved link passes
// its address as pick, so the same item stays picked. A signal can give up on
// FxTwitter early.
async function resolveTweet({ id, kind = 'video', index }, { signal, pick } = {}) {
  const [res, embed] = await Promise.all([
    fetch(`${FXTWITTER}/2/status/${id}`, { headers: HEADERS, signal }),
    fetchEmbedDetails(id),
  ]);
  const status = statusOf(await res.json().catch(() => null));
  if (!status || !status.author) {
    throw new TwitterError('That tweet could not be found.');
  }

  const { users } = embed;
  const media = mediaOf(status);
  const picked = pickMedia(media, { kind, index, pick });
  const item = media[picked];
  const video = item && item.type !== 'photo' ? item : undefined;
  const photos = media.filter((m) => m.type === 'photo');
  const text = postText(status);
  const replyingTo =
    status.replying_to && status.replying_to.status
      ? { handle: status.replying_to.screen_name, id: status.replying_to.status }
      : undefined;
  const parent =
    replyingTo && embed.parent && embed.parent.id_str === replyingTo.id
      ? summarizeEmbedPost(embed.parent, users)
      : undefined;
  const mosaic = status.media && status.media.mosaic && status.media.mosaic.formats;

  return {
    url: item ? withoutQuery(item.url) : status.url,
    tweet: {
      v: TWEET_VERSION,
      id: status.id,
      url: status.url,
      text: text.text,
      links: text.links,
      lang: status.lang || undefined,
      long: status.is_note_tweet || undefined,
      createdAt: new Date(status.created_timestamp * 1000).toISOString(),
      author: summarizeAuthor(status.author, users, { profile: true }),
      repostedBy: repostedByOf(status.reposted_by),
      replyingTo,
      parent,
      edited: embed.edited,
      latestId: embed.latestId,
      stats: statsOf(status),
      media: media.length > 0 ? media : undefined,
      // Which of the media the link picked: the video that plays, or the one
      // photo a /photo/N link shares.
      picked: item ? picked : undefined,
      // The picked video, the photos and the picked photo, as stored before
      // media lists were, for API clients that read them.
      video: video
        ? { thumbnail: video.thumbnail, duration: video.duration, width: video.width, height: video.height }
        : undefined,
      photos: !video && photos.length > 0 ? photos.map(({ url, width, height }) => ({ url, width, height })) : undefined,
      photoIndex: item && item.type === 'photo' ? photos.indexOf(item) : undefined,
      // FxTwitter's single picture of all the photos, for link previews.
      mosaic: photos.length > 1 && mosaic && /^https:\/\//.test(mosaic.jpeg) ? mosaic.jpeg : undefined,
      external: externalOf(status.media && status.media.external),
      card: cardOf(status.card),
      poll: pollOf(status.poll),
      note: noteOf(status.community_note),
      sensitive: status.possibly_sensitive || undefined,
      quote: status.quote ? summarizeQuote(status.quote, users) : undefined,
    },
  };
}

function summarizeReply(reply, rootId, extras) {
  const text = postText(reply);
  // Replies play their videos as they are, without the quality menu.
  const media = mediaOf(reply).map(({ variants, ...item }) => item);
  return {
    id: reply.id,
    url: reply.url,
    text: text.text,
    links: text.links,
    createdAt: new Date(reply.created_timestamp * 1000).toISOString(),
    likes: reply.likes,
    reposts: reply.reposts,
    views: reply.views ?? undefined,
    bookmarks: reply.bookmarks ?? undefined,
    replyCount: reply.replies || 0,
    parentId: reply.replying_to ? reply.replying_to.status : rootId,
    author: summarizeAuthor(reply.author, extras),
    media: media.length > 0 ? media : undefined,
    card: media.length > 0 ? undefined : cardOf(reply.card),
    quote: reply.quote ? summarizeQuote(reply.quote, extras) : undefined,
    sensitive: reply.possibly_sensitive || undefined,
  };
}

// Returns a page of a tweet's top replies, along with some replies to those
// replies. parentId says which post each one answers, so the page can nest
// them, and replyCount how many answers it has in all. cursor, from the
// previous page, asks for the next one; the returned cursor is null after the
// last page.
async function fetchReplies(id, cursor) {
  const url = new URL(`${FXTWITTER}/2/conversation/${id}`);
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  const res = await fetch(url, { headers: HEADERS });
  const data = await res.json().catch(() => null);
  if (!data || data.code !== 200) {
    throw new TwitterError('Could not load replies.');
  }

  // Deleted replies come back as stubs without an author.
  const replies = (data.replies || []).filter((reply) => reply && reply.id && reply.author);
  const extras = await fetchReplyExtras(replies);
  return {
    replies: replies.map((reply) => summarizeReply(reply, id, extras)),
    // FxTwitter hands out another cursor after the last page too, whose page
    // then comes back empty.
    cursor: replies.length > 0 && data.cursor && data.cursor.bottom ? data.cursor.bottom : null,
  };
}

// A post's text translated into lang (a language code like "en") by
// FxTwitter, with its links like the post's own text, the language it was
// translated from and who translated it.
async function translateTweet(id, lang) {
  const res = await fetch(`${FXTWITTER}/2/status/${id}/${encodeURIComponent(lang)}`, { headers: HEADERS });
  const status = statusOf(await res.json().catch(() => null));
  const translation = status && status.translation;
  if (!translation || typeof translation.text !== 'string' || !translation.text.trim()) {
    throw new TwitterError('This post could not be translated.');
  }
  const text = richText(translation.text, status.raw_text && status.raw_text.facets, {
    reply: Boolean(status.replying_to),
    quoteId: status.quote && status.quote.id,
  });
  return {
    text: text.text,
    links: text.links,
    from: translation.source_lang_en || translation.source_lang || undefined,
    provider: translation.provider || undefined,
  };
}

module.exports = {
  parseStatus,
  resolveTweet,
  fetchReplies,
  translateTweet,
  richText,
  TwitterError,
  isTwimg,
  TWEET_VERSION,
};
