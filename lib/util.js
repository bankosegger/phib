// Small helpers shared by the server-side libs.

// Whether a value is a web address (http or https).
function isWebUrl(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
}

// The address when it's an https one, otherwise undefined.
function httpsUrl(value) {
  return typeof value === 'string' && /^https:\/\/\S+$/i.test(value) ? value : undefined;
}

// A time in seconds since 1970 as an ISO date, or undefined when it's
// missing, so one odd post can't break a whole page.
function isoTime(seconds) {
  const date = new Date(typeof seconds === 'number' ? seconds * 1000 : NaN);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// Thrown when a post or video can't be shown: it doesn't exist, was deleted,
// is private or can't be embedded. The service failing throws a plain Error
// instead, so pages can tell "try again" apart from "not found".
class NotFoundError extends Error {}

module.exports = { isWebUrl, httpsUrl, isoTime, NotFoundError };
