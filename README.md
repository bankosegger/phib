# short-url

Minimal URL shortener built on Express and Upstash Redis. Runs on Vercel.

## Setup

```sh
cp .env.example .env   # fill in Upstash credentials and SHORT_DOMAIN
npm install
npm start              # http://localhost:3000
```

## API

- `POST /api/shorten` with `{ "url": "https://..." }` returns `{ code, shortUrl, target }`
- `GET /api/stats/:code` returns `{ code, target, createdAt, clicks }`
- `GET /:code` redirects to the target URL
