/* Renders an Instagram post the way phib shows it: the author, the caption, the
 * photos and videos (side by side in a carousel when there are several, as on
 * instagram.com) and the counts. Like public/post.js does for tweets, the page
 * a short link opens renders it on the server (lib/watch.js) and the home page
 * in the browser (public/script.js), from the same post object, so both look
 * alike. In the browser it also runs the carousel and the download buttons,
 * which save each file under a name like cobalt's, instagram_<shortcode>.mp4.
 * Media load through phib's /media proxy, since Instagram's media servers
 * refuse to show their files on other sites. */
(function (root, factory) {
  const isModule = typeof module === 'object' && module.exports;
  const PhibInstagram = factory(isModule ? require('./post') : root.PhibPost);
  if (isModule) {
    module.exports = PhibInstagram;
  } else {
    root.PhibInstagram = PhibInstagram;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PhibPost) {
  'use strict';

  const { escapeHtml, safeHref, mediaUrl, formatCount, formatDate, ratio, icon, renderAvatar, renderBadges, renderRichText } =
    PhibPost;

  // Icons, from Lucide.
  const ICONS = {
    download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    previous: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
  };

  function svg(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  // The picture that stands for a post in link previews and the history: its
  // first photo or the first frame of its first video.
  function thumbnail(post) {
    const item = Array.isArray(post.media) ? post.media[0] : undefined;
    if (item) {
      return item.type === 'video' ? item.thumbnail || post.author.avatar : item.url;
    }
    return post.author.avatar;
  }

  // What a download is saved as, the way cobalt names Instagram files:
  // instagram_<shortcode>.mp4, numbered from 1 for posts with several.
  function fileName(post, item, index) {
    const code = /^[\w-]+$/.test(post.shortcode) ? post.shortcode : 'post';
    const number = post.media.length > 1 ? `_${index + 1}` : '';
    return `instagram_${code}${number}.${item.type === 'video' ? 'mp4' : 'jpg'}`;
  }

  // The download button in a photo's or video's corner. It links to the file
  // on Instagram's servers, which opens it when the download can't run here.
  function renderDownload(post, item, index) {
    const href = safeHref(item.url);
    if (!href) {
      return '';
    }
    const what = item.type === 'video' ? 'video' : 'photo';
    const label = post.media.length > 1 ? `Download ${what} ${index + 1} of ${post.media.length}` : `Download ${what}`;
    return `<a class="media-download" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(fileName(post, item, index))}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${svg('download')}</a>`;
  }

  // A photo or video in a frame as wide as the post, over a blurred copy of
  // its picture. Only the first one loads before it's scrolled to.
  function renderFrame(post, item, index, { slide = false } = {}) {
    const picture = item.type === 'video' ? item.thumbnail : item.url;
    const src = picture ? escapeHtml(mediaUrl(picture)) : '';
    const lazy = index > 0 ? ' loading="lazy"' : '';
    const backdrop = src ? `<img class="tweet-media-backdrop" src="${src}" alt=""${lazy} />` : '';
    let content;
    if (item.type === 'video') {
      const label = item.alt ? ` aria-label="${escapeHtml(item.alt)}"` : '';
      content = `<video class="tweet-video" src="${escapeHtml(mediaUrl(item.url))}"${src ? ` poster="${src}"` : ''} controls playsinline preload="${index === 0 ? 'metadata' : 'none'}"${label}></video>`;
    } else {
      content = `<img class="tweet-photo" src="${src}" alt="${escapeHtml(item.alt || '')}"${lazy} />`;
    }
    // Slides take the carousel's size; a lone photo or video sets its own.
    const attributes = slide
      ? ` role="group" aria-roledescription="slide" aria-label="${index + 1} of ${post.media.length}"`
      : ` style="--ratio: ${ratio(item.width, item.height)}"`;
    return `<div class="tweet-media ig-media"${attributes}>${backdrop}${content}${renderDownload(post, item, index)}</div>`;
  }

  // Several photos and videos share a strip that scrolls one at a time, as tall
  // as the first one at full width, as Instagram sizes its carousels.
  function renderCarousel(post) {
    const { media } = post;
    const slides = media.map((item, index) => renderFrame(post, item, index, { slide: true })).join('');
    return [
      `<div class="ig-carousel" style="--ratio: ${ratio(media[0].width, media[0].height)}">`,
      `<div class="ig-track" tabindex="0" aria-label="${media.length} photos and videos">${slides}</div>`,
      `<button type="button" class="ig-nav" data-step="-1" aria-label="Previous" disabled>${svg('previous')}</button>`,
      `<button type="button" class="ig-nav" data-step="1" aria-label="Next">${svg('next')}</button>`,
      `<span class="ig-counter">1 / ${media.length}</span>`,
      '</div>',
    ].join('');
  }

  function renderMedia(post) {
    const media = Array.isArray(post.media) ? post.media : [];
    if (media.length === 0) {
      return '';
    }
    return media.length === 1 ? renderFrame(post, media[0], 0) : renderCarousel(post);
  }

  function renderAuthor(author) {
    const href = safeHref(author.url) || `https://www.instagram.com/${encodeURIComponent(author.handle)}/`;
    return `<div class="tweet-author">${renderAvatar(author)}<div class="tweet-author-names"><span class="tweet-name-row"><a class="tweet-name" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(author.name)}</a>${renderBadges(author)}</span><span class="tweet-handle">@${escapeHtml(author.handle)}</span></div></div>`;
  }

  // Long captions fold behind Show more, which public/post.js runs.
  function renderText(post) {
    if (!post.text) {
      return '';
    }
    const long = post.text.length > 280 || post.text.split('\n').length > 6;
    const html = `<p class="tweet-text"${long ? ' data-long' : ''}>${renderRichText(post.text, post.links)}</p>`;
    return long ? `${html}<button type="button" class="text-more" hidden>Show more</button>` : html;
  }

  function renderMeta(post, locale) {
    const parts = [];
    const date = formatDate(post.createdAt, locale);
    if (date) {
      parts.push(escapeHtml(date));
    }
    if (post.location) {
      parts.push(escapeHtml(post.location));
    }
    const url = safeHref(post.url);
    if (url) {
      parts.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener">View on Instagram</a>`);
    }
    return `<p class="tweet-meta">${parts.join(' · ')}</p>`;
  }

  // [icon, count, what it counts]. Accounts can hide likes and views, which
  // are then left out.
  const STATS = [
    ['likes', 'likes', 'likes'],
    ['replies', 'comments', 'comments'],
    ['views', 'views', 'views'],
  ];

  function renderStats(stats) {
    return STATS.map(([name, key, label]) => {
      const value = stats && stats[key];
      if (typeof value !== 'number') {
        return '';
      }
      return `<span class="tweet-stat" title="${escapeHtml(`${value} ${label}`)}">${icon(name)}<span>${escapeHtml(formatCount(value))}</span></span>`;
    }).join('');
  }

  // The inside of an <article class="tweet">: the whole post as phib shows it.
  // locale formats the date.
  function renderPost(post, { locale } = {}) {
    return [
      renderAuthor(post.author),
      renderText(post),
      renderMedia(post),
      renderMeta(post, locale),
      `<div class="tweet-stats">${renderStats(post.stats)}</div>`,
    ].join('');
  }

  // In the browser ------------------------------------------------------------

  // Which slide a carousel shows, from how far along it's scrolled.
  function currentSlide(track) {
    const index = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
    return Math.min(Math.max(index, 0), track.children.length - 1);
  }

  // Sets the counter and arrows to the slide in view, and pauses any video
  // scrolled away from.
  function update(track) {
    const carousel = track.parentElement;
    const index = currentSlide(track);
    const slides = Array.from(track.children);
    carousel.querySelector('.ig-counter').textContent = `${index + 1} / ${slides.length}`;
    for (const button of carousel.querySelectorAll('.ig-nav')) {
      const to = index + Number(button.dataset.step);
      button.disabled = to < 0 || to >= slides.length;
    }
    slides.forEach((slide, i) => {
      const video = slide.querySelector('video');
      if (video && i !== index && !video.paused) {
        video.pause();
      }
    });
  }

  // Once per frame at most, however fast the scroll events come.
  const scheduled = new WeakSet();

  function onScroll(event) {
    const track = event.target;
    if (!(track instanceof Element) || !track.classList.contains('ig-track') || scheduled.has(track)) {
      return;
    }
    scheduled.add(track);
    requestAnimationFrame(() => {
      scheduled.delete(track);
      update(track);
    });
  }

  function step(button) {
    const track = button.parentElement.querySelector('.ig-track');
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({
      left: (currentSlide(track) + Number(button.dataset.step)) * track.clientWidth,
      behavior: still ? 'auto' : 'smooth',
    });
  }

  // Saves a photo or video under its file name. The file comes through phib's
  // proxy, which hands out videos a few megabytes at a time, so it's fetched in
  // as many pieces as that takes and put back together; the button fills up as
  // they come in. If it fails, the button opens the file on Instagram's
  // servers instead, where it can be saved from the browser's player.
  async function download(link) {
    if (link.getAttribute('aria-busy') === 'true') {
      return;
    }
    link.setAttribute('aria-busy', 'true');
    try {
      const source = mediaUrl(link.getAttribute('href'));
      const parts = [];
      let type = '';
      let start = 0;
      let total = Infinity;
      while (start < total) {
        const res = await fetch(source, { headers: { Range: `bytes=${start}-` } });
        // Past the end of a file whose size wasn't given.
        if (res.status === 416 && parts.length > 0) {
          break;
        }
        if (res.status !== 200 && res.status !== 206) {
          throw new Error(`The file answered ${res.status}.`);
        }
        type = res.headers.get('content-type') || type;
        const part = await res.blob();
        parts.push(part);
        if (res.status === 200 || part.size === 0) {
          break;
        }
        const range = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
        total = range ? Number(range[1]) : Infinity;
        start += part.size;
        if (range) {
          link.style.setProperty('--progress', String(Math.min(start / total, 1)));
        }
      }
      const url = URL.createObjectURL(new Blob(parts, { type }));
      const save = document.createElement('a');
      save.href = url;
      save.download = link.getAttribute('download') || 'instagram';
      document.body.append(save);
      save.click();
      save.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      link.dataset.failed = 'true';
      link.title = 'Could not download this file here. Click again to open it instead.';
    } finally {
      link.removeAttribute('aria-busy');
      link.style.removeProperty('--progress');
    }
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const nav = target && target.closest('.ig-nav');
    if (nav) {
      step(nav);
      return;
    }
    const link = target && target.closest('a.media-download');
    // Clicks that open the link in a new tab or window still do.
    if (link && !link.dataset.failed && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      download(link);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', onClick);
    // Scroll events don't bubble, so carousels are heard while capturing.
    document.addEventListener('scroll', onScroll, true);
  }

  return { renderPost, thumbnail, fileName };
});
