# short-url

Minimal URL shortener built on Express and Upstash Redis. Runs on Vercel.

## Setup

```sh
cp .env.example .env   # fill in Upstash credentials, SHORT_DOMAIN and ADMIN_TOKEN
npm install
npm start              # http://localhost:3000
npm test               # runs offline: Redis, FxTwitter, YouTube and Instagram are stubbed
```

`INSTAGRAM_COOKIE` is optional; see [Instagram](#instagram).

## API

- `GET /api` lists the endpoints below as JSON
- `POST /api/shorten` with `{ "url": "https://..." }` (up to 8192 characters) returns `{ code, shortUrl, target }`; a `502` means FxTwitter, YouTube or Instagram didn't answer, and is worth retrying
- With `"twitterVideo": true`, Twitter/X status links are looked up via the [FxTwitter API](https://github.com/FxEmbed/FxEmbed): posts with a video or GIF are shortened to the direct `video.twimg.com` file, other posts to the post itself; the response also includes `source` and a `tweet` object. A trailing `/video/N` picks the Nth video, and `/photo/N` the Nth photo: the link is then shortened to its direct image file and only that photo is shown. The `tweet` object has:
  - `author`: name, handle, avatar and profile link; `verified` (`blue`, `gold` or `grey`, the color of their checkmark, or `null`); `affiliate` (the badge of the organization they belong to); `shape` (`square` for the square avatars of businesses); `protected`; and `profile` (bio, location, website, banner, join date and follower, following and post counts)
  - `text` as x.com shows it (short display forms of links, without the @mentions a reply starts with or the link to a quoted post) and `links`, the ranges of it that link to web pages, @mentions, #hashtags and $cashtags; `lang`; `long` for long posts
  - `stats`: replies, retweets, likes, views, quotes and bookmarks
  - `media`: every photo, video and GIF in order, with its alt text, and for videos the MP4 `variants` in other sizes; `picked`, the index of the one the link points to
  - when the post has them: `card` (the link preview), `external` (a YouTube video it links to), `poll`, `note` (a community note), `sensitive`, `replyingTo` and `parent` (the post it answers), `quote` (or `{ unavailable: true }`), `repostedBy`, `edited` and `latestId` (the newest version of an edited post), and `mosaic` (one picture of all its photos, for link previews)
  - for older clients: `video` (the picked video's thumbnail, duration and size), `photos` and `photoIndex`, as before `media` was added

  Affiliate badges, avatar shapes, edits and the parent post come from Twitter's embed endpoint, since FxTwitter leaves them out. Links saved before these details were stored get them the first time they're opened.
- With `"youtubeVideo": true`, YouTube video links (`youtube.com/watch`, `youtu.be`, Shorts) are looked up via YouTube's oEmbed endpoint; the response includes a `youtube` object (id, title, channel, thumbnail, start time) and the short link opens a phib page with the embedded player
- With `"instagramPost": true`, Instagram post and reel links (`/p/`, `/reel/`, `/reels/`, `/tv/`, `instagram.com/share/...` links from the app, `instagr.am` and `ddinstagram.com`) are looked up the way [cobalt](https://cobalt.tools) does (see [Instagram](#instagram)). The short link points to the post and opens a phib page that plays its videos and shows its photos, in a carousel when there are several, each with a download button that saves it as `instagram_<shortcode>.mp4` (or `_1.jpg`, `_2.mp4`, … for several), like cobalt names them. The response includes an `instagram` object with:
  - `shortcode`, `url` (the post on instagram.com), `text` (the caption) and `links` (its @mentions and #hashtags), `createdAt` and `location`
  - `author`: name, handle, avatar, profile link and `verified` (`blue` or `null`)
  - `stats`: likes, comments and views (accounts can hide likes and views, which are then left out)
  - `media`: every photo and video in order, with its size and alt text, and for videos the thumbnail and duration. These are addresses on Instagram's media servers, which stop working after a few days
  - `expires`: when the first of them does. Short links whose media is about to expire are looked up again when they're opened
- `GET /api/stats/:code` returns `{ code, target, createdAt, clicks }`
- `GET /api/replies/:tweetId` returns `{ replies, cursor }`: a page of a post's top replies, each with its text and links, media, link preview, quoted post, counts and the id of the post it answers, plus the cursor to pass as `?cursor=` for the next page (`null` after the last)
- `GET /api/translate/:tweetId?lang=en` returns `{ translation: { text, links, from, provider } }`: the post's text translated by FxTwitter into the given language
- `GET /:code` redirects to the target URL; Twitter/X links open a page with the post's video or photos and its details instead, YouTube links one with the embedded video, and Instagram links one with the post

## URL mode

Put the short domain in front of any link, e.g. `pb3p.uk/https://x.com/mitsuhiko/status/2113248077532545057`, to open phib with that link shortened. As when pasting a link, Twitter/X posts, YouTube videos and Instagram posts first ask whether to make a plain short link or open them in phib.

## Proxy mode

Replace `x.com` (or `twitter.com`) in a post link with the short domain, e.g. `pb3p.uk/mitsuhiko/status/2113248077532545057` (or `pb3p.uk/i/web/status/...`), to see the post in phib without creating a short link. A trailing `/video/N` picks the Nth video; `/photo/N` picks the Nth photo and marks it on the page.

The same works for YouTube: `pb3p.uk/watch?v=dQw4w9WgXcQ`, `pb3p.uk/shorts/<id>`, or `pb3p.uk/dQw4w9WgXcQ` in place of `youtu.be/dQw4w9WgXcQ`.

And for Instagram: replace `instagram.com` with the short domain, e.g. `pb3p.uk/reel/<shortcode>`, `pb3p.uk/p/<shortcode>` or `pb3p.uk/share/<id>`.

## Instagram

Instagram has no public API for posts, so phib looks them up the way [cobalt](https://cobalt.tools) does, trying each of these in turn until one answers:

1. Instagram's mobile app API: its oEmbed endpoint gives the post's media id, and its media info endpoint the post
2. The page Instagram's embeds load (`/p/<shortcode>/embed/captioned/`)
3. The GraphQL query instagram.com's web app loads posts with, sent with the tokens the post's page hands out to logged-out visitors

All of these work without logging in, but Instagram turns some servers away, and only shows some posts (like age-restricted ones) to logged-in visitors. Setting `INSTAGRAM_COOKIE` to the `Cookie` header of a logged-in instagram.com session makes phib try each again with it. Use an account you don't mind Instagram rate limiting or locking. When nothing works, the error in the logs says what each way got. Stories aren't supported.

Instagram's media servers don't let other sites show their files, so the page loads them through `/media`, which also serves Twitter's. Their addresses are signed and expire after a few days, so short links point to the post itself, and a link whose media is about to expire is looked up again when it's opened (if Instagram doesn't answer, it shows as saved and tries again next time). The download buttons fetch each file through `/media` a few megabytes at a time, which keeps each response under Vercel's limit, and fall back to opening the file on Instagram's servers.

## Admin

`/admin` lists every short link with its target, creation date and click count, and can delete links. Sign in with the `ADMIN_TOKEN` environment variable; leaving it unset disables the dashboard. The page uses these endpoints, which expect an `Authorization: Bearer <ADMIN_TOKEN>` header:

- `GET /api/admin/links` returns `{ links: [{ code, shortUrl, target, createdAt, clicks, tweet, youtube, instagram }] }`
- `DELETE /api/admin/links/:code` deletes a link and its click count
