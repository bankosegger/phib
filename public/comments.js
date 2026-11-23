// Loads the replies of a tweet into a .comments section as a tree: replies to a
// reply nest under it and fold away, and the ones FxTwitter left out load when
// their thread is opened. Further pages of replies load at the end of the list.
// Used by the home page result card and by the watch page that short links
// open. public/post.js renders the badges, linked text, media, link previews
// and quoted posts, the same way it does for the post.

// Short relative time ("5m", "3h", "2d"), the date once it's over a week old,
// or nothing when the time is missing.
function formatTimeAgo(iso) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = (Date.now() - time) / 1000;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d`;
  return new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// A count under a reply, with the post's icon for it (see ICONS in post.js).
function commentStat(kind, count) {
  const stat = document.createElement('span');
  stat.className = 'comment-stat';
  stat.title = `${count} ${kind}`;
  stat.innerHTML = PhibPost.icon(kind);
  // x.com leaves out zero counts.
  if (count) stat.append(PhibPost.formatCount(count));
  return stat;
}

// The reply on x.com. Replies come from FxTwitter, so only web addresses are
// linked, never javascript: and the like.
function replyUrl(node) {
  return PhibPost.safeHref(node.url) || `https://x.com/${encodeURIComponent(node.author.handle)}/status/${node.id}`;
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
  if (node.author.avatar) avatar.src = PhibPost.imageUrl(node.author.avatar);
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
  name.href = replyUrl(node);
  name.target = '_blank';
  name.rel = 'noopener';
  name.textContent = node.author.name;
  const handle = document.createElement('span');
  handle.className = 'comment-handle';
  handle.textContent = `@${node.author.handle}`;
  head.append(name);
  head.insertAdjacentHTML('beforeend', PhibPost.renderBadges(node.author));
  head.append(handle);
  const ago = formatTimeAgo(node.createdAt);
  if (ago) {
    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = `· ${ago}`;
    head.append(time);
  }

  const text = document.createElement('p');
  text.className = 'comment-text';
  text.innerHTML = PhibPost.renderRichText(node.text, node.links);

  // Photos, videos, a link preview or a quoted post.
  const attachments = document.createElement('div');
  attachments.className = 'comment-attachments';
  attachments.innerHTML = PhibPost.renderAttachments(node);

  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  actions.append(commentStat('replies', node.replyCount || 0));
  actions.append(commentStat('reposts', node.reposts || 0));
  actions.append(commentStat('likes', node.likes || 0));
  if (node.views != null) actions.append(commentStat('views', node.views));
  if (node.bookmarks != null) actions.append(commentStat('bookmarks', node.bookmarks));
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
      link.href = replyUrl(node);
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
  section.innerHTML =
    '<h2 class="comments-title">Replies</h2><p class="comments-status" role="status">Loading replies…</p>';
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
  more.href = PhibPost.safeHref(tweetUrl) || `https://x.com/i/status/${encodeURIComponent(tweetId)}`;
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
