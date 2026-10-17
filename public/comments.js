// Loads the top replies of a tweet into a .comments section. Used by the
// home page result card and by the watch page that short links open.

function commentsMediaUrl(value) {
  return `/media?url=${encodeURIComponent(value)}`;
}

function formatCommentDate(iso) {
  const seconds = (Date.now() - new Date(iso)) / 1000;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function renderComment(reply) {
  const li = document.createElement('li');
  li.className = 'comment';

  const avatar = document.createElement('img');
  avatar.className = 'comment-avatar';
  avatar.alt = '';
  avatar.src = commentsMediaUrl(reply.author.avatar);

  const body = document.createElement('div');
  body.className = 'comment-body';

  const head = document.createElement('div');
  head.className = 'comment-head';
  const name = document.createElement('a');
  name.className = 'comment-name';
  name.href = reply.url;
  name.target = '_blank';
  name.rel = 'noopener';
  name.textContent = reply.author.name;
  const handle = document.createElement('span');
  handle.className = 'comment-handle';
  handle.textContent = `@${reply.author.handle} · ${formatCommentDate(reply.createdAt)}`;
  head.append(name, handle);

  const text = document.createElement('p');
  text.className = 'comment-text';
  text.textContent = reply.text;

  body.append(head, text);
  if (reply.likes) {
    const likes = document.createElement('span');
    likes.className = 'comment-likes';
    const count = new Intl.NumberFormat('en', { notation: 'compact' }).format(reply.likes);
    likes.textContent = `${count} ${reply.likes === 1 ? 'like' : 'likes'}`;
    body.append(likes);
  }

  li.append(avatar, body);
  return li;
}

async function loadComments(section, tweetId, tweetUrl) {
  section.hidden = false;
  section.innerHTML = '<h2 class="comments-title">Replies</h2><p class="comments-status">Loading replies…</p>';
  const status = section.querySelector('.comments-status');

  let replies;
  try {
    const res = await fetch(`/api/replies/${encodeURIComponent(tweetId)}`);
    if (!res.ok) throw new Error();
    ({ replies } = await res.json());
  } catch {
    status.textContent = 'Could not load replies.';
    return;
  }
  if (section.dataset.loading !== tweetId) return;

  if (!replies.length) {
    status.textContent = 'No replies yet.';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'comments-list';
  list.append(...replies.map(renderComment));

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
