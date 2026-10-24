# short-url

Minimal URL shortener built on Express and Upstash Redis. Runs on Vercel.

## Setup

```sh
cp .env.example .env   # fill in Upstash credentials, SHORT_DOMAIN and ADMIN_TOKEN
npm install
npm start              # http://localhost:3000
```

## API

- `GET /api` lists the endpoints below as JSON
- `POST /api/shorten` with `{ "url": "https://..." }` returns `{ code, shortUrl, target }`
- With `"twitterVideo": true`, Twitter/X status links are looked up via the [FxTwitter API](https://github.com/FxEmbed/FxEmbed): posts with a video are shortened to the direct `video.twimg.com` file, other posts to the post itself; the response also includes `source` and a `tweet` object (author, text, stats, and the video thumbnail/duration/size or the photos)
- With `"youtubeVideo": true`, YouTube video links (`youtube.com/watch`, `youtu.be`, Shorts) are looked up via YouTube's oEmbed endpoint; the response includes a `youtube` object (id, title, channel, thumbnail, start time) and the short link opens a phib page with the embedded player
- `GET /api/stats/:code` returns `{ code, target, createdAt, clicks }`
- `GET /:code` redirects to the target URL; Twitter/X links open a page with the post's video or photos and its details instead, and YouTube links one with the embedded video

## URL mode

Put the short domain in front of any link, e.g. `pb3p.uk/https://x.com/mitsuhiko/status/2113248077532545057`, to open phib with that link shortened. The "Show Twitter/X posts in phib" and "Show YouTube videos in phib" settings from the home page apply.

## Proxy mode

Replace `x.com` (or `twitter.com`) in a post link with the short domain, e.g. `pb3p.uk/mitsuhiko/status/2113248077532545057`, to see the post in phib without creating a short link. A trailing `/video/N` picks the Nth video; `/photo/N` links work too and show all photos.

The same works for YouTube: `pb3p.uk/watch?v=dQw4w9WgXcQ`, `pb3p.uk/shorts/<id>`, or `pb3p.uk/dQw4w9WgXcQ` in place of `youtu.be/dQw4w9WgXcQ`.

## Admin

`/admin` lists every short link with its target, creation date and click count, and can delete links. Sign in with the `ADMIN_TOKEN` environment variable; leaving it unset disables the dashboard. The page uses these endpoints, which expect an `Authorization: Bearer <ADMIN_TOKEN>` header:

- `GET /api/admin/links` returns `{ links: [{ code, shortUrl, target, createdAt, clicks, tweet }] }`
- `DELETE /api/admin/links/:code` deletes a link and its click count
