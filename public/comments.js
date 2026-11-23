// Loads the replies of a tweet into a .comments section as a tree: replies to a
// reply nest under it and fold away, and the ones FxTwitter left out load when
// their thread is opened. Further pages of replies load at the end of the list.
// Used by the home page result card and by the watch page that short links
// open. public/post.js renders the badges, linked text, media, link previews
// and quoted posts, the same way it does for the post.

// Short relative time ("5m", "3h", "2d"), or the date once it's over a week old.
function formatTimeAgo(iso) {
  const seconds = (Date.now() - new Date(iso)) / 1000;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const COMMENT_ICONS = {
  reply: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  repost:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  like: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  views: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
};

function commentStat(icon, count, label) {
  const stat = document.createElement('span');
  stat.className = 'comment-stat';
  stat.title = `${count} ${label}`;
  stat.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COMMENT_ICONS[icon]}</svg>`;
  // x.com leaves out zero counts.
  if (count) stat.append(PhibPost.formatCount(count));
  return stat;
}

function pluralReplies(n) {
  return `${PhibPost.formatCount(n)} ${n === 1 ? 'reply' : 'replies'}`;
}

// Nests replies under the reply they answer. Replies to rootId, and replies to
// posts that aren't in the list, sit at the top level. Keeps FxTwitter's order.
function buildReplyTree(replies, rootId) {
  const byId = new Map(replies.map((reply) => [reply.id, { ...reply, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId !== rootId && byId.get(node.parentId);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

// A page of replies, and the cursor of the next page (null after the last).
async function fetchReplies(tweetId, cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const res = await fetch(`/api/replies/${encodeURIComponent(tweetId)}${query}`);
  if (!res.ok) throw new Error();
  const page = await res.json();
  return { replies: page.replies || [], cursor: page.cursor || null };
}

// One reply and its thread. The line under the avatar and the "Hide replies"
// button fold the thread; opening a thread whose replies weren't in the first
// load fetches them. `seen` holds the ids already on the page, and `threads`
// maps the id of each reply shown to a function adding a reply to its thread,
// for replies that turn up in later pages.
function renderThread(node, seen, threads) {
  const li = document.createElement('li');
  li.className = 'comment';

  const gutter = document.createElement('div');
  gutter.className = 'comment-gutter';
  const avatar = document.createElement('img');
  avatar.className = 'comment-avatar';
  avatar.alt = '';
  avatar.src = PhibPost.imageUrl(node.author.avatar);
  if (node.author.shape) avatar.dataset.shape = node.author.shape;
  const line = document.createElement('button');
  line.type = 'button';
  line.className = 'comment-line';
  line.setAttribute('aria-label', 'Hide replies');
  gutter.append(avatar, line);

  const main = document.createElement('div');
  main.className = 'comment-main';

  const head = document.createElement('div');
  head.className = 'comment-head';
  const name = document.createElement('a');
  name.className = 'comment-name';
  name.href = node.url;
  name.target = '_blank';
  name.rel = 'noopener';
  name.textContent = node.author.name;
  const handle = document.createElement('span');
  handle.className = 'comment-handle';
  handle.textContent = `@${node.author.handle}`;
  const time = document.createElement('span');
  time.className = 'comment-time';
  time.textContent = `· ${formatTimeAgo(node.createdAt)}`;
  head.append(name);
  head.insertAdjacentHTML('beforeend', PhibPost.renderBadges(node.author));
  head.append(handle, time);

  const text = document.createElement('p');
  text.className = 'comment-text';
  text.innerHTML = PhibPost.renderRichText(node.text, node.links);

  // Photos, videos, a link preview or a quoted post.
  const attachments = document.createElement('div');
  attachments.className = 'comment-attachments';
  attachments.innerHTML = PhibPost.renderAttachments(node);

  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  actions.append(commentStat('reply', node.replyCount || 0, 'replies'));
  actions.append(commentStat('repost', node.reposts || 0, 'reposts'));
  actions.append(commentStat('like', node.likes || 0, 'likes'));
  if (node.views != null) actions.append(commentStat('views', node.views, 'views'));
  if (node.bookmarks != null) actions.append(commentStat('bookmark', node.bookmarks, 'bookmarks'));
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'comment-toggle';
  actions.append(toggle);

  const children = document.createElement('ul');
  children.className = 'comment-children';
  for (const child of node.children) {
    children.append(renderThread(child, seen, threads));
  }

  main.append(head, text);
  if (attachments.innerHTML) {
    main.append(attachments);
    // Holds GIFs still for readers who prefer less motion.
    PhibPost.enhance(attachments);
  }
  main.append(actions, children);
  li.append(gutter, main);

  // Replies left out of the loads so far: a button fetches them, and once
  // fetched, any still missing are only on X.
  const more = document.createElement('div');
  more.className = 'comment-more';
  main.append(more);

  let fetched = false;
  let collapsed = false;
  const total = () => Math.max(node.replyCount || 0, node.children.length);

  function update() {
    const open = !collapsed && node.children.length > 0;
    const left = total() - node.children.length;
    children.hidden = !open;
    line.hidden = !open;
    toggle.hidden = node.children.length === 0 && (fetched || left === 0);
    toggle.setAttribute('aria-expanded', open);
    toggle.textContent = open ? 'Hide replies' : `Show ${pluralReplies(total())}`;

    more.replaceChildren();
    more.hidden = left === 0 || collapsed || (node.children.length === 0 && !fetched);
    if (fetched) {
      const link = document.createElement('a');
      link.href = node.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = node.children.length ? `${pluralReplies(left)} more on X` : `View ${pluralReplies(left)} on X`;
      more.append(link);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Show ${pluralReplies(left)} more`;
      button.addEventListener('click', load);
      more.append(button);
    }
  }

  function add(child) {
    node.children.push(child);
    children.append(renderThread(child, seen, threads));
    update();
  }
  threads.set(node.id, add);

  async function load() {
    toggle.disabled = true;
    toggle.textContent = 'Loading…';
    try {
      const { replies } = await fetchReplies(node.id);
      const fresh = replies.filter((reply) => !seen.has(reply.id));
      for (const reply of fresh) seen.add(reply.id);
      for (const child of buildReplyTree(fresh, node.id)) {
        node.children.push(child);
        children.append(renderThread(child, seen, threads));
      }
    } catch {
      // The link to the thread on X stands in for the replies.
    }
    fetched = true;
    collapsed = false;
    toggle.disabled = false;
    update();
  }

  toggle.addEventListener('click', () => {
    if (node.children.length === 0) {
      load();
      return;
    }
    collapsed = !collapsed;
    update();
  });
  line.addEventListener('click', () => {
    collapsed = true;
    update();
    if (li.getBoundingClientRect().top < 0) li.scrollIntoView({ block: 'start' });
  });

  update();
  return li;
}

async function loadComments(section, tweetId, tweetUrl) {
  section.hidden = false;
  section.innerHTML = '<h2 class="comments-title">Replies</h2><p class="comments-status">Loading replies…</p>';
  const status = section.querySelector('.comments-status');

  let page;
  try {
    page = await fetchReplies(tweetId);
  } catch {
    status.textContent = 'Could not load replies.';
    return;
  }
  if (section.dataset.loading !== tweetId) return;

  if (!page.replies.length) {
    status.textContent = 'No replies yet.';
    return;
  }

  const seen = new Set(page.replies.map((reply) => reply.id));
  const threads = new Map();
  const list = document.createElement('ul');
  list.className = 'comments-list';
  list.append(...buildReplyTree(page.replies, tweetId).map((node) => renderThread(node, seen, threads)));

  // The next pages. A reply to a reply that's already shown joins its thread.
  let { cursor } = page;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'comments-next';
  next.textContent = 'Show more replies';
  next.hidden = !cursor;
  next.addEventListener('click', async () => {
    next.disabled = true;
    next.textContent = 'Loading…';
    try {
      const nextPage = await fetchReplies(tweetId, cursor);
      const fresh = nextPage.replies.filter((reply) => !seen.has(reply.id));
      for (const reply of fresh) seen.add(reply.id);
      for (const node of buildReplyTree(fresh, tweetId)) {
        const addToThread = node.parentId !== tweetId && threads.get(node.parentId);
        if (addToThread) addToThread(node);
        else list.append(renderThread(node, seen, threads));
      }
      // A page of replies that are all on the page already means there are no
      // more to come.
      cursor = fresh.length > 0 ? nextPage.cursor : null;
    } catch {
      // The button stays, to try again.
    }
    next.disabled = false;
    next.textContent = 'Show more replies';
    next.hidden = !cursor;
  });

  const more = document.createElement('a');
  more.className = 'comments-more';
  more.href = tweetUrl;
  more.target = '_blank';
  more.rel = 'noopener';
  more.textContent = 'See all replies on X';

  status.replaceWith(list, next, more);
}

function showComments(section, tweetId, tweetUrl) {
  section.dataset.loading = tweetId;
  return loadComments(section, tweetId, tweetUrl);
}

function clearComments(section) {
  delete section.dataset.loading;
  section.innerHTML = '';
  section.hidden = true;
}

for (const section of document.querySelectorAll('.comments[data-tweet-id]')) {
  showComments(section, section.dataset.tweetId, section.dataset.tweetUrl);
}
