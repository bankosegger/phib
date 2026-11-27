/* Renders a tweet the way phib shows it. The page a short link opens renders it
 * on the server (lib/watch.js) and the home page renders it in the browser once
 * a link is shortened (public/script.js), from the same tweet object, so both
 * look alike; the replies (public/comments.js) use its pieces too. In the
 * browser it also handles the buttons it renders: sensitive media, ALT text,
 * Show more, Translate post and the video quality menu. */
(function (root, factory) {
  const PhibPost = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = PhibPost;
  } else {
    root.PhibPost = PhibPost;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Links only go to web pages and phib's own pages, never javascript: and the like.
  function safeHref(value) {
    return typeof value === 'string' && /^(?:https?:\/\/|\/(?!\/))/i.test(value) ? value : null;
  }

  // twimg.com is blocked as a third-party tracker by Firefox strict mode and
  // many content blockers, and Instagram's media servers refuse to show their
  // files on other sites, so their media loads through phib's /media proxy.
  function mediaUrl(value) {
    return `/media?url=${encodeURIComponent(value)}`;
  }

  function isTwimg(value) {
    return typeof value === 'string' && /^https:\/\/(?:[\w-]+\.)*twimg\.com\//i.test(value);
  }

  function isInstagramCdn(value) {
    return typeof value === 'string' && /^https:\/\/(?:[\w-]+\.)*(?:cdninstagram\.com|fbcdn\.net)\//i.test(value);
  }

  // Twitter's and Instagram's pictures load through the proxy, others (like
  // YouTube thumbnails) directly.
  function imageUrl(value) {
    return isTwimg(value) || isInstagramCdn(value) ? mediaUrl(value) : value;
  }

  // Made once: a page of replies formats hundreds of counts.
  const COMPACT_NUMBER = new Intl.NumberFormat('en', { notation: 'compact' });
  const WHOLE_NUMBER = new Intl.NumberFormat('en');

  function formatCount(n) {
    return COMPACT_NUMBER.format(n);
  }

  // The date, or nothing when it's missing.
  function formatDate(iso, locale) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { dateStyle: 'medium' });
  }

  function formatDuration(seconds) {
    const total = Math.round(seconds || 0);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  // Width over height, so frames have their size before the media loads.
  function ratio(width, height) {
    const value = Number(width) / Number(height);
    return Number.isFinite(value) && value > 0 ? Number(value.toFixed(4)) : 1.7778;
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  // Links saved before tweet ids were stored only have the tweet url.
  function postId(post) {
    if (post.id) {
      return String(post.id);
    }
    const match = typeof post.url === 'string' && post.url.match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  }

  // A post's own phib page, or one of its videos with suffix /video/N.
  function postPage(post, suffix = '') {
    return `/${encodeURIComponent(post.author.handle)}/status/${encodeURIComponent(postId(post))}${suffix}`;
  }

  // Icons, from Lucide.
  const ICONS = {
    replies: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    reposts:
      '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    likes:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    views: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
    quotes:
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 12a2 2 0 0 0 2-2V8H8"/><path d="M14 12a2 2 0 0 0 2-2V8h-2"/>',
    bookmarks: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    location: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    link:
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    calendar:
      '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    readers:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
  };

  function icon(name, className = 'icon') {
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  // Lucide's badge-check, filled in the checkmark's color like x.com's.
  const VERIFIED_ICON =
    '<path class="badge-shape" d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path class="badge-check" d="m9 12 2 2 4-4"/>';

  // The lock of a protected account, the verified checkmark and the affiliate
  // badge that follow an author's name, as on x.com. Quotes and parent posts
  // are links themselves, so their affiliate badges link nowhere. The class
  // names leave out "affiliate", since ad blockers hide .affiliate-link
  // everywhere.
  function renderBadges(author, { link = true } = {}) {
    let html = '';
    if (author.protected) {
      html += `<svg class="protected-badge" viewBox="0 0 24 24" role="img" aria-label="Protected account"><title>Protected account</title>${ICONS.lock}</svg>`;
    }
    if (author.verified) {
      html += `<svg class="verified-badge" data-color="${escapeHtml(author.verified)}" viewBox="0 0 24 24" role="img" aria-label="Verified account"><title>Verified account</title>${VERIFIED_ICON}</svg>`;
    }
    const { affiliate } = author;
    if (affiliate && affiliate.badge) {
      const name = escapeHtml(affiliate.name || '');
      const img = `<img class="org-badge" src="${escapeHtml(mediaUrl(affiliate.badge))}" alt="${name}" title="${name}" />`;
      const href = link && safeHref(affiliate.url);
      html += href ? `<a class="org-badge-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">${img}</a>` : img;
    }
    return `<span class="author-badges">${html}</span>`;
  }

  // Square for businesses, as on x.com.
  function renderAvatar(author, className = 'tweet-avatar') {
    const shape = author.shape ? ` data-shape="${escapeHtml(author.shape)}"` : '';
    return author.avatar
      ? `<img class="${className}" src="${escapeHtml(imageUrl(author.avatar))}" alt=""${shape} />`
      : `<span class="${className}"${shape}></span>`;
  }

  // Text with the given ranges linked (see richText in lib/twitter.js). Inside
  // quotes and parent posts, which are links themselves, the links stay text.
  function renderRichText(text, links, { linked = true } = {}) {
    const value = typeof text === 'string' ? text : '';
    if (!linked || !Array.isArray(links)) {
      return escapeHtml(value);
    }
    let html = '';
    let pos = 0;
    for (const link of links) {
      if (!(link.start >= pos && link.end > link.start && link.end <= value.length)) {
        continue;
      }
      const label = escapeHtml(value.slice(link.start, link.end));
      const href = safeHref(link.url);
      html += escapeHtml(value.slice(pos, link.start));
      html += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener nofollow">${label}</a>` : label;
      pos = link.end;
    }
    return html + escapeHtml(value.slice(pos));
  }

  // Twitter marks posts without a language with codes like qme (media only),
  // qht (hashtags only), und and zxx.
  function isLanguage(code) {
    return (
      typeof code === 'string' &&
      /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code) &&
      !/^(?:q[a-t][a-z]|und|zxx|art|mis|mul)$/i.test(code)
    );
  }

  // Media ---------------------------------------------------------------------

  // The media of a post and which one its link picked. Links saved before phib
  // kept whole media lists have just the picked video, or the photos and maybe
  // a picked one; the video plays from the link's own address.
  function mediaOf(post, target) {
    if (Array.isArray(post.media)) {
      return { media: post.media, picked: post.picked };
    }
    if (post.video) {
      const { thumbnail, width, height, duration } = post.video;
      return { media: [{ type: 'video', url: target, thumbnail, width, height, duration }], picked: 0 };
    }
    if (Array.isArray(post.photos) && post.photos.length > 0) {
      const media = post.photos.map(({ url, width, height }) => ({ type: 'photo', url, width, height }));
      const picked = post.photoIndex != null ? Math.min(post.photoIndex, media.length - 1) : undefined;
      return { media, picked };
    }
    return { media: [] };
  }

  function pickedMedia(post, target) {
    const { media, picked } = mediaOf(post, target);
    return picked != null ? media[picked] : undefined;
  }

  // The picture that stands for a post in link previews and the history: the
  // picked photo or video, else the first of its media, its YouTube video, its
  // link preview's image or its author's avatar.
  function thumbnail(post, target) {
    const { media, picked } = mediaOf(post, target);
    const item = (picked != null && media[picked]) || media[0];
    if (item) {
      return item.type === 'photo' ? item.url : item.thumbnail || post.author.avatar;
    }
    if (post.external && post.external.thumbnail) {
      return post.external.thumbnail;
    }
    if (post.card && post.card.image) {
      return post.card.image.url;
    }
    return post.author.avatar;
  }

  // The ALT badge x.com puts on media with a description; it shows the text.
  function renderAlt(item) {
    if (!item.alt) {
      return '';
    }
    return `<button type="button" class="alt-badge" aria-expanded="false" aria-label="Media description">ALT</button><span class="alt-text" hidden>${escapeHtml(item.alt)}</span>`;
  }

  // A video or GIF in a frame as wide as the post. GIFs loop silently, as on
  // x.com. The main one (the video a link picked) answers the quality menu.
  function renderPlayer(item, { main = false, preload = 'metadata' } = {}) {
    const poster = item.thumbnail ? escapeHtml(imageUrl(item.thumbnail)) : '';
    const gif = item.type === 'gif';
    const attributes = [
      `class="tweet-video${gif ? ' gif-video' : ''}"`,
      `src="${escapeHtml(mediaUrl(item.url))}"`,
      poster ? `poster="${poster}"` : '',
      gif ? 'autoplay loop muted playsinline' : `controls playsinline preload="${preload}"`,
      main ? 'data-main' : '',
      item.alt ? `aria-label="${escapeHtml(item.alt)}"` : '',
    ].filter(Boolean);
    const backdrop = poster ? `<img class="tweet-media-backdrop" src="${poster}" alt="" />` : '';
    const badge = gif ? '<span class="media-badge">GIF</span>' : '';
    return `<div class="tweet-media" style="--ratio: ${ratio(item.width, item.height)}">${backdrop}<video ${attributes.join(' ')}></video>${badge}${renderAlt(item)}</div>`;
  }

  // Videos are numbered among the post's videos and GIFs, as /video/N counts them.
  function videoNumber(item, media) {
    return media.filter((m) => m.type !== 'photo').indexOf(item) + 1;
  }

  // One tile of a grid: a photo opens full size, a video or GIF its own phib
  // page, where it plays.
  function renderTile(item, post, media) {
    if (item.type === 'photo') {
      const src = escapeHtml(mediaUrl(item.url));
      return `<div class="media-tile"><a href="${src}" target="_blank" rel="noopener"><img class="tweet-photo" src="${src}" alt="${escapeHtml(item.alt || '')}" /></a>${renderAlt(item)}</div>`;
    }
    const thumb = item.thumbnail
      ? `<img class="tweet-photo" src="${escapeHtml(imageUrl(item.thumbnail))}" alt="${escapeHtml(item.alt || '')}" />`
      : '';
    const label = item.type === 'gif' ? 'GIF' : item.duration ? formatDuration(item.duration) : 'Video';
    const href = escapeHtml(postPage(post, `/video/${videoNumber(item, media)}`));
    return `<div class="media-tile"><a href="${href}" aria-label="Play ${item.type === 'gif' ? 'GIF' : 'video'}">${thumb}<span class="media-play">${icon('play', 'play-icon')}</span><span class="media-badge">${label}</span></a></div>`;
  }

  // One item fills the frame; several share a grid like x.com's.
  function renderGallery(items, post, { preload } = {}) {
    if (items.length === 1) {
      const [item] = items;
      if (item.type !== 'photo') {
        return renderPlayer(item, { preload });
      }
      const src = escapeHtml(mediaUrl(item.url));
      return `<div class="tweet-media tweet-photos" data-count="1" style="--ratio: ${ratio(item.width, item.height)}"><img class="tweet-media-backdrop" src="${src}" alt="" />${renderTile(item, post, items)}</div>`;
    }
    const shown = items.slice(0, 4);
    const tiles = shown.map((item) => renderTile(item, post, items)).join('');
    return `<div class="tweet-media tweet-photos" data-count="${shown.length}">${tiles}</div>`;
  }

  // A YouTube video the post links to, playing in the post as on x.com.
  function renderExternal(external) {
    if (!external || !/^[\w-]{11}$/.test(external.id)) {
      return '';
    }
    const start = Number(external.start) > 0 ? `?start=${Number(external.start)}` : '';
    const thumb =
      typeof external.thumbnail === 'string' && /^https:\/\//.test(external.thumbnail)
        ? `<img class="tweet-media-backdrop" src="${escapeHtml(external.thumbnail)}" alt="" />`
        : '';
    return `<div class="tweet-media" style="--ratio: ${ratio(external.width || 16, external.height || 9)}">${thumb}<iframe class="tweet-video youtube-player" src="https://www.youtube-nocookie.com/embed/${external.id}${start}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
  }

  // Media marked as possibly sensitive stays blurred until Show is clicked.
  function renderSensitive(html) {
    return `<div class="sensitive">${html}<div class="sensitive-cover"><p>This post may contain sensitive media.</p><button type="button" class="sensitive-show">Show</button></div></div>`;
  }

  // The video a link picked plays full width, with the post's other media in a
  // row of tiles underneath. A /photo/N link shares just that photo, so only it
  // is shown. Otherwise all the media share a grid, or the YouTube video the
  // post links to plays.
  function renderMedia(post, { target } = {}) {
    const { media, picked } = mediaOf(post, target);
    const item = picked != null ? media[picked] : undefined;
    let html;
    if (item && item.type !== 'photo') {
      const others = media.filter((m) => m !== item);
      const strip = others.length
        ? `<div class="media-strip">${others.map((other) => renderTile(other, post, media)).join('')}</div>`
        : '';
      html = renderPlayer(item, { main: true }) + strip;
    } else if (item) {
      html = renderGallery([item], post);
    } else if (media.length > 0) {
      html = renderGallery(media, post);
    } else {
      return renderExternal(post.external);
    }
    return post.sensitive ? renderSensitive(html) : html;
  }

  // Link previews, polls, notes and quotes --------------------------------------

  // The preview of a link in the post: a wide image above the title, or a
  // small square one beside it. Inside a quote it isn't a link of its own.
  function renderCard(card, { link = true } = {}) {
    const href = card && safeHref(card.url);
    if (!href) {
      return '';
    }
    const { image } = card;
    const large = Boolean(image && image.url && card.large);
    const style = large ? ` style="--ratio: ${ratio(image.width, image.height)}"` : '';
    const img =
      image && image.url
        ? `<img class="post-card-image" src="${escapeHtml(imageUrl(image.url))}" alt="${escapeHtml(image.alt || '')}"${style} loading="lazy" />`
        : '';
    const body = [
      `<span class="post-card-domain">${escapeHtml(card.domain || '')}</span>`,
      card.title ? `<span class="post-card-title">${escapeHtml(card.title)}</span>` : '',
      card.description ? `<span class="post-card-description">${escapeHtml(card.description)}</span>` : '',
    ].join('');
    const size = large ? 'large' : 'small';
    return link
      ? `<a class="post-card" data-size="${size}" href="${escapeHtml(href)}" target="_blank" rel="noopener nofollow">${img}<span class="post-card-body">${body}</span></a>`
      : `<span class="post-card" data-size="${size}">${img}<span class="post-card-body">${body}</span></span>`;
  }

  function timeLeft(iso) {
    const minutes = Math.ceil((Date.parse(iso) - Date.now()) / 60000);
    if (minutes < 60) {
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
    }
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'} left`;
  }

  // The results of a poll, with the leading choice in bold as on x.com.
  function renderPoll(poll) {
    if (!poll || !Array.isArray(poll.choices) || poll.choices.length === 0) {
      return '';
    }
    const top = Math.max(...poll.choices.map((choice) => choice.count || 0));
    const choices = poll.choices
      .map((choice) => {
        const percentage = Math.min(100, Math.max(0, Math.round((choice.percentage || 0) * 10) / 10));
        const leading = top > 0 && choice.count === top ? ' poll-leading' : '';
        return `<li class="poll-choice${leading}"><span class="poll-bar" style="width: ${percentage}%"></span><span class="poll-label">${escapeHtml(choice.label)}</span><span class="poll-percentage">${percentage}%</span></li>`;
      })
      .join('');
    const total = poll.total || 0;
    const meta = [`${WHOLE_NUMBER.format(total)} ${total === 1 ? 'vote' : 'votes'}`];
    const ends = Date.parse(poll.endsAt);
    if (Number.isFinite(ends)) {
      meta.push(ends > Date.now() ? timeLeft(poll.endsAt) : 'Final results');
    }
    return `<div class="post-poll"><ol class="poll-choices">${choices}</ol><p class="poll-meta">${escapeHtml(meta.join(' · '))}</p></div>`;
  }

  // A community note: context readers added to the post.
  function renderNote(note) {
    if (!note || !note.text) {
      return '';
    }
    return `<aside class="post-note"><p class="post-note-title">${icon('readers')}Readers added context</p><p class="post-note-text">${renderRichText(note.text, note.links)}</p></aside>`;
  }

  // Small squares for the photos and video thumbnails of a quote or parent post.
  function renderThumbs(post) {
    if (!Array.isArray(post.images) || post.images.length === 0) {
      return '';
    }
    const thumbs = post.images
      .map((image) => {
        const play = image.video ? `<span class="thumb-play">${icon('play', 'play-icon')}</span>` : '';
        return `<span class="tweet-quote-thumb"><img class="tweet-quote-image" src="${escapeHtml(imageUrl(image.url))}" alt="${escapeHtml(image.alt || '')}" />${play}</span>`;
      })
      .join('');
    return `<span class="tweet-quote-images"${post.sensitive ? ' data-sensitive' : ''}>${thumbs}</span>`;
  }

  const COMPACT_STATS = [
    ['replies', 'replies'],
    ['reposts', 'retweets'],
    ['likes', 'likes'],
    ['views', 'views'],
  ];

  function renderCompactStats(stats) {
    if (!stats) {
      return '';
    }
    const items = COMPACT_STATS.filter(([, key]) => typeof stats[key] === 'number')
      .map(
        ([kind, key]) =>
          `<span class="compact-stat" title="${escapeHtml(`${stats[key]} ${kind}`)}">${icon(kind)}${escapeHtml(formatCount(stats[key]))}</span>`
      )
      .join('');
    return items ? `<span class="compact-stats">${items}</span>` : '';
  }

  // The name, badges, handle and date of a quote or parent post.
  function renderCompactAuthor(post, locale) {
    const formatted = formatDate(post.createdAt, locale);
    const date = formatted ? ` · ${escapeHtml(formatted)}` : '';
    return `<span class="tweet-name-row"><span class="tweet-name">${escapeHtml(post.author.name)}</span>${renderBadges(post.author, { link: false })}</span><span class="tweet-handle">@${escapeHtml(post.author.handle)}${date}</span>`;
  }

  // The quoted post: a smaller post in a box that opens its own phib page, or a
  // note that it's unavailable.
  function renderQuote(quote, { locale } = {}) {
    if (!quote) {
      return '';
    }
    if (quote.unavailable || !quote.author) {
      return `<div class="tweet-quote tweet-quote-unavailable">${escapeHtml(quote.message || 'This post is unavailable.')}</div>`;
    }
    const text = quote.text
      ? `<span class="tweet-text">${renderRichText(quote.text, quote.links, { linked: false })}</span>`
      : '';
    return `<a class="tweet-quote" href="${escapeHtml(postPage(quote))}"><span class="tweet-author">${renderAvatar(quote.author)}<span class="tweet-author-names">${renderCompactAuthor(quote, locale)}</span></span>${text}${renderThumbs(quote)}${quote.card ? renderCard(quote.card, { link: false }) : ''}${renderCompactStats(quote.stats)}</a>`;
  }

  // The post a reply answers, above it as in a thread on x.com, opening its own
  // phib page.
  function renderParent(parent, { locale } = {}) {
    if (!parent || !parent.author) {
      return '';
    }
    const text = parent.text
      ? `<span class="tweet-text">${renderRichText(parent.text, parent.links, { linked: false })}</span>`
      : '';
    return `<a class="post-parent" href="${escapeHtml(postPage(parent))}"><span class="post-parent-gutter">${renderAvatar(parent.author)}</span><span class="post-parent-main"><span class="post-parent-head">${renderCompactAuthor(parent, locale)}</span>${text}${renderThumbs(parent)}${renderCompactStats(parent.stats)}</span></a>`;
  }

  // The post --------------------------------------------------------------------

  // What x.com shows when hovering an author: banner, bio, location, website,
  // join date and counts. It opens on hover or when the avatar is tapped.
  function renderProfileCard(author, locale) {
    const { profile } = author;
    const facts = [];
    if (profile.location) {
      facts.push(`<span>${icon('location')}${escapeHtml(profile.location)}</span>`);
    }
    const website = profile.website && safeHref(profile.website.url);
    if (website) {
      facts.push(
        `<a href="${escapeHtml(website)}" target="_blank" rel="noopener nofollow">${icon('link')}${escapeHtml(profile.website.display || website)}</a>`
      );
    }
    if (profile.joined) {
      const joined = new Date(profile.joined).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      facts.push(`<span>${icon('calendar')}Joined ${escapeHtml(joined)}</span>`);
    }
    const counts = [
      [profile.following, 'Following'],
      [profile.followers, 'Followers'],
      [profile.posts, 'Posts'],
    ]
      .filter(([count]) => typeof count === 'number')
      .map(([count, label]) => `<span><strong>${escapeHtml(formatCount(count))}</strong> ${label}</span>`)
      .join('');
    const banner = isTwimg(profile.banner)
      ? `<img class="profile-banner" src="${escapeHtml(mediaUrl(`${profile.banner}/600x200`))}" alt="" />`
      : '<span class="profile-banner"></span>';
    return [
      `<div class="profile-card" role="group" aria-label="About @${escapeHtml(author.handle)}">`,
      banner,
      '<div class="profile-body">',
      renderAvatar(author, 'profile-avatar'),
      `<span class="tweet-name-row"><span class="tweet-name">${escapeHtml(author.name)}</span>${renderBadges(author)}</span>`,
      `<span class="tweet-handle">@${escapeHtml(author.handle)}</span>`,
      profile.bio ? `<p class="profile-bio">${renderRichText(profile.bio.text, profile.bio.links)}</p>` : '',
      facts.length > 0 ? `<p class="profile-facts">${facts.join('')}</p>` : '',
      counts ? `<p class="profile-counts">${counts}</p>` : '',
      '</div></div>',
    ].join('');
  }

  function renderAuthor(author, { locale } = {}) {
    const href = safeHref(author.url) || `https://x.com/${encodeURIComponent(author.handle)}`;
    const avatar = author.profile
      ? `<button type="button" class="author-avatar-btn" aria-label="About @${escapeHtml(author.handle)}">${renderAvatar(author)}</button>`
      : renderAvatar(author);
    const names = `<div class="tweet-author-names"><span class="tweet-name-row"><a class="tweet-name" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(author.name)}</a>${renderBadges(author)}</span><span class="tweet-handle">@${escapeHtml(author.handle)}</span></div>`;
    return `<div class="tweet-author">${avatar}${names}${author.profile ? renderProfileCard(author, locale) : ''}</div>`;
  }

  function renderRepost(user) {
    if (!user || !user.handle) {
      return '';
    }
    const href = safeHref(user.url) || `https://x.com/${encodeURIComponent(user.handle)}`;
    return `<p class="post-repost">${icon('reposts')}<span><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(user.name || `@${user.handle}`)}</a> reposted</span></p>`;
  }

  // Shown on an earlier version of an edited post.
  function renderStale(post) {
    if (!post.latestId || !/^\d+$/.test(post.latestId)) {
      return '';
    }
    const href = `/${encodeURIComponent(post.author.handle)}/status/${post.latestId}`;
    return `<p class="post-stale">There's a newer version of this post. <a href="${escapeHtml(href)}">See the latest version</a></p>`;
  }

  // Replies show who they answer, unless the post they answer is shown above.
  function renderReplyingTo(replyingTo) {
    if (!replyingTo || !replyingTo.handle) {
      return '';
    }
    const href = /^\d+$/.test(replyingTo.id)
      ? `/${encodeURIComponent(replyingTo.handle)}/status/${replyingTo.id}`
      : `https://x.com/${encodeURIComponent(replyingTo.handle)}`;
    return `<p class="post-replying">Replying to <a href="${escapeHtml(href)}">@${escapeHtml(replyingTo.handle)}</a></p>`;
  }

  // The text, in its language so it reads right. Long posts fold after a dozen
  // lines behind Show more, and posts in another language than the reader's
  // offer a translation.
  function renderText(post) {
    if (!post.text) {
      return '';
    }
    const lang = isLanguage(post.lang) ? ` lang="${escapeHtml(post.lang)}"` : '';
    let html = `<p class="tweet-text"${lang}${post.long ? ' data-long' : ''}>${renderRichText(post.text, post.links)}</p>`;
    if (post.long) {
      html += '<button type="button" class="text-more" hidden>Show more</button>';
    }
    if (isLanguage(post.lang) && postId(post)) {
      html += `<button type="button" class="post-translate" data-id="${escapeHtml(postId(post))}" data-lang="${escapeHtml(post.lang)}" hidden>Translate post</button><div class="post-translation" hidden></div>`;
    }
    return html;
  }

  // The quality menu of the video a link picked, when it comes in several sizes.
  function renderQuality(item) {
    const options = item.variants
      .map(
        (variant) =>
          `<option value="${escapeHtml(mediaUrl(variant.url))}"${variant.url === item.url ? ' selected' : ''}>${Math.min(variant.width, variant.height)}p</option>`
      )
      .join('');
    return `<select class="video-quality" aria-label="Video quality">${options}</select>`;
  }

  function renderMeta(post, { target, locale }) {
    const item = pickedMedia(post, target);
    const parts = [];
    const date = formatDate(post.createdAt, locale);
    if (date) {
      parts.push(escapeHtml(date));
    }
    if (post.edited) {
      parts.push('<span class="post-edited">Edited</span>');
    }
    const url = safeHref(post.url);
    if (url) {
      parts.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">View on X</a>`);
    }
    const file = safeHref(target);
    if (item && file && file !== post.url) {
      parts.push(`<a href="${escapeHtml(file)}" target="_blank" rel="noopener">Open ${item.type === 'photo' ? 'photo' : 'video'} file</a>`);
    }
    if (item && Array.isArray(item.variants) && item.variants.length > 1) {
      parts.push(renderQuality(item));
    }
    return `<p class="tweet-meta">${parts.join(' · ')}</p>`;
  }

  const STATS = [
    ['replies', 'replies'],
    ['reposts', 'retweets'],
    ['likes', 'likes'],
    ['views', 'views'],
    ['quotes', 'quotes'],
    ['bookmarks', 'bookmarks'],
  ];

  // Old tweets have no view count, and links saved before quotes and bookmarks
  // were stored have neither; missing counts are left out.
  function renderStats(stats) {
    return STATS.map(([kind, key]) => {
      const count = stats && stats[key];
      if (count == null) {
        return '';
      }
      return `<span class="tweet-stat" title="${escapeHtml(`${count} ${kind}`)}">${icon(kind)}<span>${escapeHtml(formatCount(count))}</span></span>`;
    }).join('');
  }

  // The inside of an <article class="tweet">: the whole post as phib shows it.
  // target is the address the link points to (the picked video or photo file,
  // or the post itself); locale formats the dates.
  function renderPost(post, { target, locale } = {}) {
    const media = renderMedia(post, { target });
    const hasMedia = mediaOf(post, target).media.length > 0 || Boolean(post.external);
    return [
      renderRepost(post.repostedBy),
      renderParent(post.parent, { locale }),
      renderAuthor(post.author, { locale }),
      renderStale(post),
      post.parent ? '' : renderReplyingTo(post.replyingTo),
      renderText(post),
      media,
      renderPoll(post.poll),
      // As on x.com, a post with media shows no link preview.
      hasMedia ? '' : renderCard(post.card),
      renderQuote(post.quote, { locale }),
      renderNote(post.note),
      renderMeta(post, { target, locale }),
      `<div class="tweet-stats">${renderStats(post.stats)}</div>`,
    ].join('');
  }

  // A reply's photos, videos, link preview and quoted post.
  function renderAttachments(reply, { locale } = {}) {
    const hasMedia = Array.isArray(reply.media) && reply.media.length > 0;
    const media = hasMedia ? renderGallery(reply.media, reply, { preload: 'none' }) : '';
    return [
      media && reply.sensitive ? renderSensitive(media) : media,
      hasMedia ? '' : renderCard(reply.card),
      renderQuote(reply.quote, { locale }),
    ].join('');
  }

  // In the browser ------------------------------------------------------------

  // Twitter still uses a few old language codes.
  const OLD_LANGUAGE_CODES = { in: 'id', iw: 'he', ji: 'yi' };

  function baseLanguage(code) {
    const base = String(code || '')
      .toLowerCase()
      .split('-')[0];
    return OLD_LANGUAGE_CODES[base] || base;
  }

  function readerLanguage() {
    return baseLanguage((typeof navigator !== 'undefined' && navigator.language) || 'en');
  }

  // Sets up what depends on the layout or the reader: Translate shows for posts
  // in another language than the reader's, Show more for long posts that don't
  // fit, and GIFs hold still for readers who prefer less motion.
  function enhance(root) {
    for (const button of root.querySelectorAll('.post-translate')) {
      button.hidden = baseLanguage(button.dataset.lang) === readerLanguage();
    }
    for (const text of root.querySelectorAll('.tweet-text[data-long]')) {
      text.classList.add('is-clamped');
      const overflows = text.scrollHeight - text.clientHeight > 2;
      text.classList.toggle('is-clamped', overflows);
      const more = text.nextElementSibling;
      if (more && more.classList.contains('text-more')) {
        more.hidden = !overflows;
      }
    }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const video of root.querySelectorAll('video.gif-video')) {
        video.removeAttribute('autoplay');
        video.pause();
        video.controls = true;
      }
    }
  }

  async function translate(button) {
    const box = button.nextElementSibling;
    if (!box.hidden) {
      box.hidden = true;
      button.textContent = 'Translate post';
      return;
    }
    if (!box.dataset.done) {
      button.disabled = true;
      button.textContent = 'Translating…';
      const lang = readerLanguage();
      try {
        const res = await fetch(`/api/translate/${encodeURIComponent(button.dataset.id)}?lang=${encodeURIComponent(lang)}`);
        const data = await res.json();
        if (!res.ok || !data.translation) {
          throw new Error(data.error);
        }
        const { translation } = data;
        const from = translation.from ? ` from ${escapeHtml(translation.from)}` : '';
        const by = translation.provider ? ` by ${escapeHtml(capitalize(translation.provider))}` : '';
        box.innerHTML = `<p class="post-translation-label">Translated${from}${by}</p><p class="tweet-text" lang="${escapeHtml(lang)}">${renderRichText(translation.text, translation.links)}</p>`;
        box.dataset.done = 'true';
      } catch {
        box.innerHTML = '<p class="post-translation-label">This post could not be translated.</p>';
      }
      button.disabled = false;
    }
    box.hidden = false;
    button.textContent = box.dataset.done ? 'Hide translation' : 'Translate post';
  }

  function onClick(event) {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) {
      return;
    }
    if (button.classList.contains('sensitive-show')) {
      button.closest('.sensitive').classList.add('revealed');
    } else if (button.classList.contains('alt-badge')) {
      const text = button.nextElementSibling;
      text.hidden = !text.hidden;
      button.setAttribute('aria-expanded', String(!text.hidden));
    } else if (button.classList.contains('text-more')) {
      const clamped = button.previousElementSibling.classList.toggle('is-clamped');
      button.textContent = clamped ? 'Show more' : 'Show less';
    } else if (button.classList.contains('post-translate')) {
      translate(button);
    }
  }

  // Switching quality keeps the video where it was, playing if it was.
  function onChange(event) {
    const select = event.target;
    if (!(select instanceof Element) || !select.classList.contains('video-quality')) {
      return;
    }
    const post = select.closest('.tweet');
    const video = post && post.querySelector('video[data-main]');
    if (!video) {
      return;
    }
    const { currentTime } = video;
    const playing = !video.paused;
    video.src = select.value;
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = currentTime;
        if (playing) {
          video.play().catch(() => {});
        }
      },
      { once: true }
    );
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    enhance(document);
  }

  return {
    escapeHtml,
    safeHref,
    icon,
    mediaUrl,
    imageUrl,
    formatCount,
    formatDate,
    ratio,
    postId,
    pickedMedia,
    thumbnail,
    renderPost,
    renderBadges,
    renderAvatar,
    renderRichText,
    renderAttachments,
    enhance,
  };
});
