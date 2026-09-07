const { Redis } = require('@upstash/redis');

function resolveCredentials() {
  const urlKey = Object.keys(process.env).find((key) => key.endsWith('_KV_REST_API_URL'));
  const tokenKey = Object.keys(process.env).find((key) => key.endsWith('_KV_REST_API_TOKEN'));

  if (urlKey && tokenKey) {
    return { url: process.env[urlKey], token: process.env[tokenKey] };
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  }

  throw new Error(
    'Missing Upstash Redis credentials. Connect an Upstash database to this project in the Vercel Storage tab.'
  );
}

module.exports = new Redis(resolveCredentials());
