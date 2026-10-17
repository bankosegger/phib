# short-url

Minimal URL shortener built on Express and Upstash Redis. Runs on Vercel.

## Setup

```sh
cp .env.example .env   # fill in Upstash credentials and SHORT_DOMAIN
npm install
npm start              # http://localhost:3000
```

## API

- `GET /api` lists the endpoints below as JSON
- `POST /api/shorten` with `{ "url": "https://..." }` returns `{ code, shortUrl, target }`
- With `"twitterVideo": true`, Twitter/X status links are resolved to the direct `video.twimg.com` file via the [FxTwitter API](https://github.com/FxEmbed/FxEmbed) before shortening; the response also includes `source` and a `tweet` object (author, text, stats, video thumbnail/duration/size)
- `GET /api/stats/:code` returns `{ code, target, createdAt, clicks }`
- `GET /:code` redirects to the target URL; Twitter video links open a watch page with the video and tweet details instead
