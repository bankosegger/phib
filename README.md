# short-url

Minimal URL shortener built on Express and Upstash Redis. Runs on Vercel.

## Setup

```sh
cp .env.example .env   # fill in Upstash credentials, SHORT_DOMAIN and ADMIN_TOKEN
npm install
npm start              # http://localhost:3000
npm test               # runs offline: Redis, FxTwitter and YouTube are stubbed
```

## API

- `GET /api` lists the endpoints below as JSON
- `POST /api/shorten` with `{ "url": "https://..." }` (up to 8192 characters) returns `{ code, shortUrl, target }`; a `502` means FxTwitter or YouTube didn't answer, and is worth retrying
- With `"twitterVideo": true`, Twitter/X status links are looked up via the [FxTwitter API](https://github.com/FxEmbed/FxEmbed): posts with a video or GIF are shortened to the direct `video.twimg.com` file, other posts to the post itself; the response also includes `source` and a `tweet` object. A trailing `/video/N` picks the Nth video, and `/photo/N` the Nth photo: the link is then shortened to its direct image file and only that photo is shown. The `tweet` object has:
  - `author`: name, handle, avatar and profile link; `verified` (`blue`, `gold` or `grey`, the color of their checkmark, or `null`); `affiliate` (the badge of the organization they belong to); `shape` (`square` for the square avatars of businesses); `protected`; and `profile` (bio, location, website, banner, join date and follower, following and post counts)
  - `text` as x.com shows it (short display forms of links, without the @mentions a reply starts with or the link to a quoted post) and `links`, the ranges of it that link to web pages, @mentions, #hashtags and $cashtags; `lang`; `long` for long posts
  - `stats`: replies, retweets, likes, views, quotes and bookmarks
  - `media`: every photo, video and GIF in order, with its alt text, and for videos the MP4 `variants` in other sizes; `picked`, the index of the one the link points to
  - when the post has them: `card` (the link preview), `external` (a YouTube video it links to), `poll`, `note` (a community note), `sensitive`, `replyingTo` and `parent` (the post it answers), `quote` (or `{ unavailable: true }`), `repostedBy`, `edited` and `latestId` (the newest version of an edited post), and `mosaic` (one picture of all its photos, for link previews)
  - for older clients: `video` (the picked video's thumbnail, duration and size), `photos` and `photoIndex`, as before `media` was added

  Affiliate badges, avatar shapes, edits and the parent post come from Twitter's embed endpoint, since FxTwitter leaves them out. Links saved before these details were stored get them the first time they're opened.
- With `"youtubeVideo": true`, YouTube video links (`youtube.com/watch`, `youtu.be`, Shorts) are looked up via YouTube's oEmbed endpoint; the response includes a `youtube` object (id, title, channel, thumbnail, start time) and the short link opens a phib page with the embedded player
- `GET /api/stats/:code` returns `{ code, target, createdAt, clicks }`
- `GET /api/replies/:tweetId` returns `{ replies, cursor }`: a page of a post's top replies, each with its text and links, media, link preview, quoted post, counts and the id of the post it answers, plus the cursor to pass as `?cursor=` for the next page (`null` after the last)
- `GET /api/translate/:tweetId?lang=en` returns `{ translation: { text, links, from, provider } }`: the post's text translated by FxTwitter into the given language
- `GET /:code` redirects to the target URL; Twitter/X links open a page with the post's video or photos and its details instead, and YouTube links one with the embedded video

## URL mode

Put the short domain in front of any link, e.g. `pb3p.uk/https://x.com/mitsuhiko/status/2113248077532545057`, to open phib with that link shortened. As when pasting a link, Twitter/X posts and YouTube videos first ask whether to make a plain short link or open them in phib.

## Proxy mode

Replace `x.com` (or `twitter.com`) in a post link with the short domain, e.g. `pb3p.uk/mitsuhiko/status/2113248077532545057` (or `pb3p.uk/i/web/status/...`), to see the post in phib without creating a short link. A trailing `/video/N` picks the Nth video; `/photo/N` picks the Nth photo and marks it on the page.

The same works for YouTube: `pb3p.uk/watch?v=dQw4w9WgXcQ`, `pb3p.uk/shorts/<id>`, or `pb3p.uk/dQw4w9WgXcQ` in place of `youtu.be/dQw4w9WgXcQ`.

## Admin

`/admin` lists every short link with its target, creation date and click count, and can delete links. Sign in with the `ADMIN_TOKEN` environment variable; leaving it unset disables the dashboard. The page uses these endpoints, which expect an `Authorization: Bearer <ADMIN_TOKEN>` header:

- `GET /api/admin/links` returns `{ links: [{ code, shortUrl, target, createdAt, clicks, tweet }] }`
- `DELETE /api/admin/links/:code` deletes a link and its click count
