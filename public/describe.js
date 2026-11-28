// What a link points to, in one line: the post for Twitter/X and Instagram
// links, the video for YouTube ones, otherwise the target address without its
// protocol. Shared by the history on the home page (public/script.js) and the
// admin table (public/admin.js).
function describeTarget(item) {
  if (item.tweet) {
    return `@${item.tweet.handle}: ${item.tweet.text}`;
  }
  if (item.youtube) {
    return `${item.youtube.channel}: ${item.youtube.title}`;
  }
  if (item.instagram) {
    return item.instagram.text ? `@${item.instagram.handle}: ${item.instagram.text}` : `@${item.instagram.handle}`;
  }
  return (item.source || item.target).replace(/^https?:\/\/(www\.)?/, '');
}
