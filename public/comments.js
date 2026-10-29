// Loads the replies of a tweet into a .comments section as a tree: replies to a
// reply nest under it and fold away, and the ones FxTwitter left out load when
// their thread is opened. Used by the home page result card and by the watch
// page that short links open.

function commentsMediaUrl(value) {
  return `/media?url=${encodeURIComponent(value)}`;
}

function formatCompact(n) {
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(n);
}

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
  like: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
};

function commentStat(icon, count, label) {
  const stat = document.createElement('span');
  stat.className = 'comment-stat';
  stat.title = `${count} ${label}`;
  stat.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COMMENT_ICONS[icon]}</svg>`;
  // x.com leaves out zero counts.
  if (count) stat.append(formatCompact(count));
  return stat;
}

function pluralReplies(n) {
  return `${formatCompact(n)} ${n === 1 ? 'reply' : 'replies'}`;
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

async function fetchReplies(tweetId) {
  const res = await fetch(`/api/replies/${encodeURIComponent(tweetId)}`);
  if (!res.ok) throw new Error();
  return (await res.json()).replies;
}

// One reply and its thread. The line under the avatar and the "Hide replies"
// button fold the thread; opening a thread whose replies weren't in the first
// load fetches them. `seen` holds the ids already on the page.
function renderThread(node, seen) {
  const li = document.createElement('li');
  li.className = 'comment';

  const gutter = document.createElement('div');
  gutter.className = 'comment-gutter';
  const avatar = document.createElement('img');
  avatar.className = 'comment-avatar';
  avatar.alt = '';
  avatar.src = commentsMediaUrl(node.author.avatar);
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
  head.append(name, handle, time);

  const text = document.createElement('p');
  text.className = 'comment-text';
  text.textContent = node.text;

  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  actions.append(commentStat('reply', node.replyCount || 0, 'replies'));
  actions.append(commentStat('like', node.likes || 0, 'likes'));
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'comment-toggle';
  actions.append(toggle);

  const children = document.createElement('ul');
  children.className = 'comment-children';
  for (const child of node.children) {
    children.append(renderThread(child, seen));
  }

  main.append(head, text, actions, children);
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

  async function load() {
    toggle.disabled = true;
    toggle.textContent = 'Loading…';
    try {
      const replies = (await fetchReplies(node.id)).filter((reply) => !seen.has(reply.id));
      for (const reply of replies) seen.add(reply.id);
      for (const child of buildReplyTree(replies, node.id)) {
        node.children.push(child);
        children.append(renderThread(child, seen));
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

  let replies;
  try {
    replies = await fetchReplies(tweetId);
  } catch {
    status.textContent = 'Could not load replies.';
    return;
  }
  if (section.dataset.loading !== tweetId) return;

  if (!replies.length) {
    status.textContent = 'No replies yet.';
    return;
  }

  const seen = new Set(replies.map((reply) => reply.id));
  const list = document.createElement('ul');
  list.className = 'comments-list';
  list.append(...buildReplyTree(replies, tweetId).map((node) => renderThread(node, seen)));

  const more = document.createElement('a');
  more.className = 'comments-more';
  more.href = tweetUrl;
  more.target = '_blank';
  more.rel = 'noopener';
  more.textContent = 'See all replies on X';

  status.replaceWith(list, more);
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
