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
- `GET /api/stats/:code` returns `{ code, target, createdAt, clicks }`
- `GET /:code` redirects to the target URL; Twitter/X links open a page with the post's video or photos and its details instead

## Admin

`/admin` lists every short link with its target, creation date and click count, and can delete links. Sign in with the `ADMIN_TOKEN` environment variable; leaving it unset disables the dashboard. The page uses these endpoints, which expect an `Authorization: Bearer <ADMIN_TOKEN>` header:

- `GET /api/admin/links` returns `{ links: [{ code, shortUrl, target, createdAt, clicks, tweet }] }`
- `DELETE /api/admin/links/:code` deletes a link and its click count
